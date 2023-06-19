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

	let paletteRunMain = vscode.commands.registerCommand('kube-debug.paletteRunMain', async () => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		const confName = await vscode.window.showQuickPick(configs.buildTasks.map((c: any) => c.name), {
			placeHolder: 'Select a configuration',
		});

		if (!confName) {
			return;
		}
		const taskCfg = configs.buildTasks.find((c: any) => c.name === confName);
		if (!taskCfg) {
			vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
			return;
		}
		await task.runMain(taskCfg, workDir);
	});

	let paletteDebugMain = vscode.commands.registerCommand('kube-debug.paletteDebugMain', async () => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		const confName = await vscode.window.showQuickPick(configs.buildTasks.map((c: any) => c.name), {
			placeHolder: 'Select a configuration',
		});

		if (!confName) {
			return;
		}
		const taskCfg = configs.buildTasks.find((c: any) => c.name === confName);
		if (!taskCfg) {
			vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
			return;
		}
		await task.debugMain(taskCfg, workDir);
	});

	let clickRunMain = vscode.commands.registerCommand('kube-debug.clickRunMain', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		const relativeDir = path.relative(workDir, path.dirname(fsPath));
		const taskCfg = config.createOrGetTask(symbolName, relativeDir, "build");
		console.log(taskCfg);

		await task.runMain(taskCfg, workDir);
	});

	let clickDebugMain = vscode.commands.registerCommand('kube-debug.clickDebugMain', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		
		const relativeDir = path.relative(workDir, path.dirname(fsPath));
		const taskCfg = config.createOrGetTask(symbolName, relativeDir, "build");
		console.log(taskCfg);

		await task.debugMain(taskCfg, workDir);
	});

	let paletteRunTest = vscode.commands.registerCommand('kube-debug.paletteRunTest', async () => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		const confName = await vscode.window.showQuickPick(configs.testTasks.map((c: any) => c.name), {
			placeHolder: 'Select a configuration',
		});

		if (!confName) {
			return;
		}
		const taskCfg = configs.buildTasks.find((c: any) => c.name === confName);
		if (!taskCfg) {
			vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
			return;
		}
		await task.runTest(taskCfg, workDir);
	});

	let paletteDebugTest = vscode.commands.registerCommand('kube-debug.paletteDebugTest', async () => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		const confName = await vscode.window.showQuickPick(configs.testTasks.map((c: any) => c.name), {
			placeHolder: 'Select a configuration',
		});

		if (!confName) {
			return;
		}
		const taskCfg = configs.testTasks.find((c: any) => c.name === confName);
		if (!taskCfg) {
			vscode.window.showErrorMessage(`Configuration ${confName} not found.`);
			return;
		}
		await task.debugTest(taskCfg, workDir);
	});

	let clickRunTest = vscode.commands.registerCommand('kube-debug.clickRunTest', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}
		
		const relativeDir = path.relative(workDir, path.dirname(fsPath));
		const taskCfg = config.createOrGetTask(symbolName, relativeDir, "test");
		console.log(taskCfg);

		await task.runTest(taskCfg, workDir);
	});

	let clickDebugTest = vscode.commands.registerCommand('kube-debug.clickDebugTest', async (symbolName: string, fsPath: string) => {
		const [workDir, confPath, configs] = config.loadConfig();
		if (!workDir) {
			vscode.window.showErrorMessage('Please open a workspace first.');
			return;
		}

		const relativeDir = path.relative(workDir, path.dirname(fsPath));
		const taskCfg = config.createOrGetTask(symbolName, relativeDir, "test");
		console.log(taskCfg);
		
		await task.debugTest(taskCfg, workDir);
	});

	context.subscriptions.push(paletteRunMain);
	context.subscriptions.push(paletteDebugMain);
	context.subscriptions.push(clickRunMain);
	context.subscriptions.push(clickDebugMain);

	context.subscriptions.push(paletteRunTest);
	context.subscriptions.push(paletteDebugTest);
	context.subscriptions.push(clickRunTest);
	context.subscriptions.push(clickDebugTest);
}

export function deactivate() { }