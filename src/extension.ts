import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as path from 'path';

import * as config from './config';
import * as codelens from './codelens';
import * as util from "./util";


export function activate(context: vscode.ExtensionContext) {
	let clProvider = new codelens.GoCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(
		{ scheme: 'file', language: 'go' },
		clProvider,
	));

	let compileToPodCmd = vscode.commands.registerCommand('kube-debug.compileToPod', async () => {
		const [workDir, confPath, configs] = config.loadConfig();
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

		await util.execAsync(`${conf.buildCommand}`);
		const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		await util.execAsync(`kubectl cp ${conf.binary} ${conf.namespace}/${conf.pod}:${conf.targetPath} -c ${containerName}`);
		await util.execAsync(`rm -rf ${conf.binary}`);
		await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- pkill -SIGUSR1 -f "python.*supervisor.py"`);

		vscode.window.showInformationMessage(`copied new binary to pod: ${conf.pod}`);
	});

	let attachToPodCmd = vscode.commands.registerCommand('kube-debug.attachToPod', async () => {
		const [workDir, confPath, configs] = config.loadConfig();
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
		await util.sleep(1000);

		const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		const logPath = path.join(path.dirname(conf.targetPath), "debug.log");
		let command = `kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- tail -n 50 ${logPath} -f`;
		let outputChannelName = "Kube-Debug: Tail Log";
		let outputChannel = util.getOrCreateOutputChannel(outputChannelName);

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
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		const conf = configs.testConfigurations;
		let debugBin = `_debug_bin_${symbolName}`;
		const testFileDir = path.dirname(fsPath);
		const relativeDir = path.relative(workDir, testFileDir);

		const taskCfg = config.createOrGetTask(`${workDir}/.vscode/kube-debug-v2.json`, symbolName, relativeDir, "test");
		console.log(taskCfg);

		console.log(debugBin, relativeDir, path.dirname(fsPath));
		process.chdir(testFileDir);

		await util.execAsync(`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -gcflags="all=-N -l" -o ${debugBin}`);
		const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
		const targetDir = path.dirname(targetBin);
		const gotestFlags = (conf.testFlags || []).join(" ");

		await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
		await util.execAsync(`kubectl cp ${testFileDir}/${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
		await util.execAsync(`rm -rf ${debugBin}`);

		const envVars = {
			ENV_VAR_1: 'xxx yyy'
		};
		let envVarString = "";
		if (Object.keys(envVars || {}).length > 0) {
			envVarString = "export " + Object.entries(envVars)
				.map(([key, value]) => `${key}='${value}'`)
				.join(' ') + " && ";
		}


		await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "${envVarString} cd ${targetDir} && ./${debugBin} ${gotestFlags} -test.run ${symbolName}"`, {}, "Kube-Debug: Run Test");
	});
	let debugTestCmd = vscode.commands.registerCommand('kube-debug.debugTest', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = config.loadConfig();
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

		await util.execAsync(`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -gcflags="all=-N -l" -o ${debugBin}`);
		const { stdout: containerName } = await util.execAsync(`kubectl get pod ${conf.pod} -n ${conf.namespace} -o jsonpath="{.spec.containers[0].name}"`);
		const targetBin = path.join(conf.targetDir, relativeDir, debugBin);
		const targetDir = path.dirname(targetBin);
		const gotestFlags = (conf.testFlags || []).join(" ");

		await util.execAsync(`kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- mkdir -p ${targetDir}`);
		await util.execAsync(`kubectl cp ${debugBin} ${conf.namespace}/${conf.pod}:${targetBin} -c ${containerName}`);
		await util.execAsync(`rm -rf ${debugBin}`);

		let command = `kubectl exec ${conf.pod} -n ${conf.namespace} -c ${containerName} -- bash -c "cd ${targetDir} && dlv exec --headless --listen=:2346 --api-version=2 -- ${targetBin} ${gotestFlags} -test.run ${symbolName}"`;
		let outputChannelName = "Kube-Debug: Debug Test";
		let outputChannel = util.getOrCreateOutputChannel(outputChannelName);

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
		await util.sleep(1000);

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