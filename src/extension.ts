import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
//import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

//let client: LanguageClient;

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
	});
	let runTestCmd =  vscode.commands.registerCommand('kube-debug.runTest', async () => {
	});
	let debugTestCmd =  vscode.commands.registerCommand('kube-debug.debugTest', async () => {
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

    context.subscriptions.push(compileToPodCmd);
	context.subscriptions.push(attachToPodCmd);
	context.subscriptions.push(runTestCmd);
	context.subscriptions.push(debugTestCmd);
}

export function deactivate() {}

function execAsync(command: string) {
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