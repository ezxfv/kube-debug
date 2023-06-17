import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as lodash from 'lodash';


let variables = {
	"userHome": os.homedir(),
	"workspaceFolder": vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '',
	"workspaceFolderBasename": vscode.workspace.workspaceFolders ? path.basename(vscode.workspace.workspaceFolders[0].uri.fsPath) : '',
	"file": vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.fsPath : '',
	"fileWorkspaceFolder": vscode.window.activeTextEditor ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath : '',
	"relativeFile": vscode.window.activeTextEditor ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri.fsPath) : '',
	"relativeFileDirname": vscode.window.activeTextEditor ? path.dirname(vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri.fsPath)) : '',
	"fileBasename": vscode.window.activeTextEditor ? path.basename(vscode.window.activeTextEditor.document.uri.fsPath) : '',
	"fileBasenameNoExtension": vscode.window.activeTextEditor ? path.basename(vscode.window.activeTextEditor.document.uri.fsPath, path.extname(vscode.window.activeTextEditor.document.uri.fsPath)) : '',
	"fileExtname": vscode.window.activeTextEditor ? path.extname(vscode.window.activeTextEditor.document.uri.fsPath) : '',
	"fileDirname": vscode.window.activeTextEditor ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath) : '',
	"fileDirnameBasename": vscode.window.activeTextEditor ? path.basename(path.dirname(vscode.window.activeTextEditor.document.uri.fsPath)) : '',
	"cwd": process.cwd(),
	"lineNumber": vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line + 1 : '',
	"selectedText": vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection) : '',
	"execPath": process.execPath,
	"pathSeparator": path.sep,
	"defaultBuildTask": '',
};

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

const outputChannels = new Map();
function getOrCreateOutputChannel(name: string) {
	if (!outputChannels.has(name)) {
		outputChannels.set(name, vscode.window.createOutputChannel(name));
	}
	let outputChannel = outputChannels.get(name);
	outputChannel.show(true);
	return outputChannel;
}

function resolveVariables(value: any): any {
	if (typeof value === 'string') {
		for (let variable in variables) {
			value = value.replace('${' + variable + '}', (variables as Record<string, string>)[variable]);
		}
	} else if (Array.isArray(value)) {
		value = value.map(resolveVariables);
	} else if (typeof value === 'object' && value !== null) {
		value = lodash.cloneDeep(value);
		for (let key in value) {
			value[key] = resolveVariables(value[key]);
		}
	}
	return value;
}

function loadConfig(confFile: string = ".vscode/kube-debug.json"): [string, string, any] {
	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('Please open a workspace first.');
		return ['', '', null];
	}
	const configPath = `${workspaceFolder.uri.fsPath}/${confFile}`;
	const configContent = fs.readFileSync(configPath, 'utf-8');
	const config = JSON.parse(configContent);
	const renderedConfig = resolveVariables(config);
	return [renderedConfig.cwd || workspaceFolder.uri.fsPath, configPath, renderedConfig];
}

function createOrGetTask(configPath: string, symbolName: string, pkgPath: string, templateType: string): any {
	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	const tasks = (templateType === 'build' ? config.buildTasks : config.testTasks) || [];
	const taskTemplate = templateType === 'build' ? config.buildTemplate : config.testTemplate;
	const taskName = templateType === 'build' ? `${taskTemplate.name} ${pkgPath}` : `${taskTemplate.name} ${pkgPath}.${symbolName}`;

	const taskIndex = tasks.findIndex((task) => task.name === taskName);
	if (taskIndex > -1) {
		const oldTask = tasks[taskIndex];
		return oldTask;
	}

	const newTask = { ...taskTemplate, name: taskName, cwd: `${pkgPath}` };
	if (templateType === 'test')
	{
		config.testName = symbolName;
	}
	tasks.push(newTask);
	if (templateType === 'build')
	{
		config.buildTasks = tasks;
	} else {
		config.testTasks = tasks;
	}
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

	return newTask;
}

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
	async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
		const flatSymbols = this.flattenSymbols(symbols || [], document.uri);

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

export function activate(context: vscode.ExtensionContext) {
	let clProvider = new GoCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(
		{ scheme: 'file', language: 'go' },
		clProvider,
	));

	let compileToPodCmd = vscode.commands.registerCommand('kube-debug.compileToPod', async () => {
		const [workDir, confPath, configs] = loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		const confName = await vscode.window.showQuickPick(configs.configurations.map((c: any) => c.name), {
			placeHolder: 'Select a configuration',
		});

		if (!confName) {
			return;
		}
		const conf = configs.configurations.find((c: any) => c.name === confName);
		if (!conf) {
			vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
			return;
		}

		process.chdir(workDir);

		await execAsync(`${conf.buildCommand}`);
		const { stdout: containerName } = await execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		await execAsync(`kubectl cp ${conf.binary} ${conf.namespace}/${conf.pod}:${conf.targetPath} -c ${containerName}`);
		await execAsync(`rm -rf ${conf.binary}`);
		await execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`);
	});

	let attachToPodCmd = vscode.commands.registerCommand('kube-debug.attachToPod', async () => {
		const [workDir, confPath, configs] = loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		const confName = await vscode.window.showQuickPick(configs.configurations.map((c: any) => c.name), {
			placeHolder: 'Select a configuration',
		});

		if (!confName) {
			return;
		}
		const conf = configs.configurations.find((c: any) => c.name === confName);
		if (!conf) {
			vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
			return;
		}
		let portForwardProc = child_process.spawn('kubectl', ['port-forward', '-n', `${conf.namespace || "default"}`, `pods/${conf.pod}`, '2345:2345']);
		await sleep(1000);

		const { stdout: containerName } = await execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		const logPath = path.join(path.dirname(conf.targetPath), "debug.log");
		let command = `kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- tail -n 50 ${logPath} -f`;
		let outputChannelName = "Kube-Debug: Tail Log";
		let outputChannel = getOrCreateOutputChannel(outputChannelName);

		let tailLogProc = child_process.spawn(command, { shell: true });

		tailLogProc.stdout.on('data', (data) => {
			outputChannel.append(data.toString());
		});

		tailLogProc.stderr.on('data', (data) => {
			outputChannel.append(data.toString());
		});

		tailLogProc.on('exit', (code, signal) => {
			if (code !== 0) {
				outputChannel.append(`Exited with ${code || signal}`);
			}
		});

		let debugTaskName = `Attach to Kube Pod ${conf.namespace || "default"}/${conf.pod}`;
		vscode.debug.startDebugging(undefined, {
			type: 'go',
			request: 'attach',
			name: debugTaskName,
			mode: "remote",
			remotePath: workDir,
			host: "127.0.0.1",
			port: 2345
		});

		vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.name === debugTaskName) {
				// 调试会话结束时，kill子进程
				portForwardProc.kill();
				tailLogProc.kill();
				console.log(`portForwardProc process killed, exitCode: ${portForwardProc.exitCode}`);
				console.log(`tailLogProc process killed, exitCode: ${tailLogProc.exitCode}`);
			}
		});
	});
	let runTestCmd = vscode.commands.registerCommand('kube-debug.runTest', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		const conf = configs.testConfigurations;
		let debugBin = `_debug_bin_${symbolName}`;
		const testFileDir = path.dirname(fsPath);
		const relativeDir = path.relative(workDir, testFileDir);

		const taskCfg = createOrGetTask(`${workDir}/.vscode/kube-debug-v2.json`, symbolName, relativeDir, "test");
		console.log(taskCfg);

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
	let debugTestCmd = vscode.commands.registerCommand('kube-debug.debugTest', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		const conf = configs.testConfigurations;
		let debugBin = `_debug_bin_${symbolName}`;
		const testFileDir = path.dirname(fsPath);
		const relativeDir = path.relative(workDir, testFileDir);
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
		let outputChannelName = "Kube-Debug: Debug Test";
		let outputChannel = getOrCreateOutputChannel(outputChannelName);

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
			remotePath: workDir,
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

export function deactivate() { }