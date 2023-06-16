import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('kube-debug.compileToPod', async () => {
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

    context.subscriptions.push(disposable);
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
