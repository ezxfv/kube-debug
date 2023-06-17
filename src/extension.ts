import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
	// gopls server options
	let serverOptions: ServerOptions = {
		run: { command: 'gopls', transport: TransportKind.stdio },
		debug: { command: 'gopls', transport: TransportKind.stdio }
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for Go documents
		documentSelector: [{ scheme: 'file', language: 'go' }],
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'kubeDebugGoLanguageServer',
		'Go Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
	let clProvider = new GoCodeLensProvider(client);
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
	client: LanguageClient;

	constructor(client: LanguageClient) {
		this.client = client;
	}
	async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
		// Get symbols from gopls
		const params = { textDocument: { uri: document.uri.toString() } };
		const symbols = await client.sendRequest<any>('textDocument/documentSymbol', params);
		
		// Create codelens for each main function and test case
		let codelenses: vscode.CodeLens[] = [];
		for (let symbol of symbols) {
			if (symbol.name === 'main' || symbol.name.startsWith('Test')) {
				const range = new vscode.Range(
					symbol.selectionRange.start.line,
					symbol.selectionRange.start.character,
					symbol.selectionRange.end.line,
					symbol.selectionRange.end.character
				);
				const command: vscode.Command = {
					command: symbol.name === 'main' ? 'kube-debug.compileToPod' : 'kube-debug.debugTest',
					title: symbol.name === 'main' ? 'Compile to Pod' : 'Kube Debug',
					arguments: [symbol.name, document.uri.fsPath]
				};
				codelenses.push(new vscode.CodeLens(range, command));
			}
		}
		return codelenses;
	}
}