import * as vscode from 'vscode';
import * as path from 'path';

import * as config from './config';
import * as codelens from './codelens';
import * as task from "./task";

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
		await task.runMain(conf, workDir);
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
		await task.debugMain(conf, workDir);
	});
	let runTestCmd = vscode.commands.registerCommand('kube-debug.runTest', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		

		const conf = configs.testConfigurations;
		const testFileDir = path.dirname(fsPath);
		const relativeDir = path.relative(workDir, testFileDir);
		
		const taskCfg = config.createOrGetTask(`${workDir}/.vscode/kube-debug-v2.json`, symbolName, relativeDir, "test");
		console.log(taskCfg);

		conf["testName"] = symbolName;
		conf["pkgPath"] = relativeDir;

		await task.runTest(conf, workDir);
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

		conf["testName"] = symbolName;
		conf["pkgPath"] = relativeDir;
		
		await task.debugTest(conf, workDir);
	});

	context.subscriptions.push(compileToPodCmd);
	context.subscriptions.push(attachToPodCmd);
	context.subscriptions.push(runTestCmd);
	context.subscriptions.push(debugTestCmd);
}

export function deactivate() { }