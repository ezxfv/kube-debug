import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
//import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

//let client: LanguageClient;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
// Global map to cache output channels
const outputChannels = new Map();
function getOrCreateOutputChannel(name: string) {
    if (!outputChannels.has(name)) {
        outputChannels.set(name, vscode.window.createOutputChannel(name));
    }
    let outputChannel = outputChannels.get(name);
    outputChannel.show(true);
    return outputChannel;
}

export function activate(context: vscode.ExtensionContext) {
	// gopls server options
	// let serverOptions: ServerOptions = {
	// 	run: { command: 'gopls', transport: TransportKind.stdio },
	// 	debug: { command: 'gopls', transport: TransportKind.stdio }
	// };

	// // Options to control the language client
	// let clientOptions: LanguageClientOptions = {
	// 	// Register the server for Go documents
	// 	documentSelector: [{ scheme: 'file', language: 'go' }],
	// };

	// // Create the language client and start the client.
	// client = new LanguageClient(
	// 	'kubeDebugGoLanguageServer',
	// 	'Go Language Server',
	// 	serverOptions,
	// 	clientOptions
	// );

	// // Start the client. This will also launch the server
	// client.start();
	// let clProvider = new GoCodeLensProvider(client);
	let clProvider = new GoCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(
		{ scheme: 'file', language: 'go' },
		clProvider,
	));

    let compileToPodCmd = vscode.commands.registerCommand('kube-debug.compileToPod', async () => {
		const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace first.');
            return;
        }
        const configFile = path.join(workspaceFolder.uri.fsPath, '.vscode', 'kube-debug.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

		const confName = await vscode.window.showQuickPick(config.configurations.map((c: any) => c.name), {
            placeHolder: 'Select a configuration',
        });

        if (!confName) {
            return;
        }
		const conf = config.configurations.find((c: any) => c.name === confName);
        if (!conf) {
            vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
            return;
        }

		const workDir = conf.workDir || workspaceFolder.uri.fsPath;
        process.chdir(workDir);

        await execAsync(`${conf.buildCommand}`);
        const { stdout: containerName } = await execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
        await execAsync(`kubectl cp ${conf.binary} ${conf.namespace}/${conf.pod}:${conf.targetPath} -c ${containerName}`);
        await execAsync(`rm -rf ${conf.binary}`);
		await execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`);
    });

	let attachToPodCmd =  vscode.commands.registerCommand('kube-debug.attachToPod', async () => {
		const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace first.');
            return;
        }
		const configFile = path.join(workspaceFolder.uri.fsPath, '.vscode', 'kube-debug.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
		const confName = await vscode.window.showQuickPick(config.configurations.map((c: any) => c.name), {
            placeHolder: 'Select a configuration',
        });

        if (!confName) {
            return;
        }
		const conf = config.configurations.find((c: any) => c.name === confName);
        if (!conf) {
            vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
            return;
        }
		let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${conf.namespace || "default"}`, `pods/${conf.pod}`, '2345:2345']);
		console.log(`Spawned child pid: ${portForwardProc.pid}`);
		console.log(['port-forward', '-n', `${conf.namespace || "default"}`, `pods/${conf.pod}`, '2345:2345']);
		await sleep(1000);

		let debugTaskName = `Attach to Kube Pod ${conf.namespace || "default"}/${conf.pod}`;
		vscode.debug.startDebugging(undefined, {
			type: 'go',
			request: 'attach',
			name: debugTaskName,
			mode: "remote",
            remotePath: workspaceFolder.uri.fsPath,
			host: "127.0.0.1",
			port: 2345
		});

		vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.name === debugTaskName) {
				// 调试会话结束时，kill子进程
				portForwardProc.kill();
				console.log(`Child process killed, exitCode: ${portForwardProc.exitCode}`);
			}
		});
	});
	let runTestCmd =  vscode.commands.registerCommand('kube-debug.runTest', async (symbolName: string, fsPath: string) => {
		const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace first.');
            return;
        }
        const configFile = path.join(workspaceFolder.uri.fsPath, '.vscode', 'kube-debug.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
		const conf = config.testConfigurations;
		console.log(conf);
		let debugBin = `_debug_bin_${symbolName}`;
		const testFileDir = path.dirname(fsPath);
		const relativeDir = path.relative(workspaceFolder.uri.fsPath, testFileDir);
		console.log(debugBin, relativeDir, path.dirname(fsPath));
		process.chdir(testFileDir);

		await execAsync(`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -gcflags="all=-N -l" -o ${debugBin}`);
        const { stdout: containerName } = await execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
		const targetDir = path.dirname(targetBin);
		const gotestFlags = (conf.testFlags || []).join(" ");

		await execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
        await execAsync(`kubectl cp ${testFileDir}/${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
        await execAsync(`rm -rf ${debugBin}`);
		await execAsync2(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "cd ${targetDir} && ./${debugBin} ${gotestFlags} -test.run ${symbolName}"`, "Kube-Debug: Run Test");
	});
	let debugTestCmd =  vscode.commands.registerCommand('kube-debug.debugTest', async (symbolName: string, fsPath: string) => {
		const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace first.');
            return;
        }
		const wsPath = workspaceFolder.uri.fsPath;

        const configFile = path.join(wsPath, '.vscode', 'kube-debug.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
		const conf = config.testConfigurations;
		console.log(conf);
		let debugBin = `_debug_bin_${symbolName}`;
		const testFileDir = path.dirname(fsPath);
		const relativeDir = path.relative(wsPath, testFileDir);
		console.log(debugBin, relativeDir, path.dirname(fsPath));
		process.chdir(testFileDir);

		await execAsync(`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -gcflags="all=-N -l" -o ${debugBin}`);
        const { stdout: containerName } = await execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
		const targetDir = path.dirname(targetBin);
		const gotestFlags = (conf.testFlags || []).join(" ");

		await execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
        await execAsync(`kubectl cp ${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
        await execAsync(`rm -rf ${debugBin}`);
		
		let command = `kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "cd ${targetDir} && dlv exec --headless --listen=:2346 --api-version=2 -- ${targetBin} ${gotestFlags} -test.run ${symbolName}"`;
		// Get or create output channel
		let outputChannelName = "Kube-Debug: Debug Test";
		let outputChannel = getOrCreateOutputChannel(outputChannelName);

		// Use shell option for spawn to handle complex command with pipes and redirections
		let dlvProc = child_process.spawn(command, { shell: true });

		dlvProc.stdout.on('data', (data) => {
			outputChannel.append(data.toString());
		});

		dlvProc.stderr.on('data', (data) => {
			outputChannel.append(data.toString());
		});

		dlvProc.on('exit', (code, signal) => {
			if (code !== 0) {
				outputChannel.append(`Exited with ${code || signal}`);
			}
		});

		let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${conf.namespace || "default"}`, `pods/${conf.pod}`, '2346:2346']);
		console.log(`Spawned child pid: ${portForwardProc.pid}`);
		await sleep(1000);

		let debugTaskName = `Debug Test ${symbolName} in Kube Pod ${conf.namespace || "default"}/${conf.pod}`;
		vscode.debug.startDebugging(undefined, {
			type: 'go',
			request: 'attach',
			name: debugTaskName,
			mode: "remote",
            remotePath: wsPath,
			host: "127.0.0.1",
			port: 2346
		});

		vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.name === debugTaskName) {
				// 调试会话结束时，kill子进程
				portForwardProc.kill();
				dlvProc.kill();
				console.log(`port forward process killed, exitCode: ${portForwardProc.exitCode}`);
				console.log(`dlv process killed, exitCode: ${dlvProc.exitCode}`);
			}
		});
	});

    context.subscriptions.push(compileToPodCmd);
	context.subscriptions.push(attachToPodCmd);
	context.subscriptions.push(runTestCmd);
	context.subscriptions.push(debugTestCmd);
}

export function deactivate() {}

function execAsync(command: string) {
	console.log(`exec: ${command}`);

    return new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
        child_process.exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

function execAsync2(command: string, outputChannelName: string = 'kube-debug') {
	console.log(`output: ${outputChannelName}, exec: ${command}`);

    return new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
        // Get or create output channel
        let outputChannel = getOrCreateOutputChannel(outputChannelName);

        const child = child_process.exec(command);

        if (child.stdout) {
            child.stdout.on('data', (data) => {
                outputChannel.append(data.toString());
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data) => {
                outputChannel.append(data.toString());
            });
        }

        child.on('error', (error) => {
            reject(error);
        });

        child.on('exit', (code, signal) => {
            if (code !== 0) {
                reject(new Error(`Exited with ${code || signal}`));
                return;
            }

            resolve({ stdout: outputChannelName, stderr: outputChannelName });
        });
    });
}

class GoCodeLensProvider implements vscode.CodeLensProvider {
	// client: LanguageClient;

	// constructor(client: LanguageClient) {
	// 	this.client = client;
	// }
	async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        // Get symbols from vscode
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
        const flatSymbols = this.flattenSymbols(symbols || [], document.uri);

        // Create codelens for each main function and test case
        let codelenses: vscode.CodeLens[] = [];
        for (let symbol of flatSymbols) {
            if (symbol.name === 'main' || symbol.name.startsWith('Test')) {
                const range = symbol.location.range;
                const runCommand: vscode.Command = {
                    command: symbol.name === 'main' ? 'kube-debug.compileToPod' : 'kube-debug.runTest',
                    title: 'Kube Run',
                    arguments: [symbol.name, document.uri.fsPath]
                };
				const debugCommand: vscode.Command = {
                    command: symbol.name === 'main' ? 'kube-debug.compileToPod' : 'kube-debug.debugTest',
                    title: 'Kube Debug',
                    arguments: [symbol.name, document.uri.fsPath]
                };
                codelenses.push(new vscode.CodeLens(range, runCommand));
				codelenses.push(new vscode.CodeLens(range, debugCommand));
            }
        }
        return codelenses;
    }

    flattenSymbols(symbols: vscode.DocumentSymbol[], uri: vscode.Uri, containerName = ''): vscode.SymbolInformation[] {
		const result: vscode.SymbolInformation[] = [];
		for (const symbol of symbols) {
			const symbolInformation = new vscode.SymbolInformation(
				symbol.name, 
				symbol.kind, 
				containerName,
				new vscode.Location(uri, symbol.range)
			);
			result.push(symbolInformation);
			if (symbol.children.length > 0) {
				result.push(...this.flattenSymbols(symbol.children, uri, symbol.name));
			}
		}
		return result;
	}
}