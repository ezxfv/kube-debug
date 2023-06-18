import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import * as lodash from 'lodash';


function getConfigFilePath(): string {
	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('Please open a workspace first.');
	}
	return path.join(workspaceFolder.uri.fsPath, ".vscode/kube-debug.json");
}

export function resolveVariables(config: any, value: any): any {
	let variables = {
		"userHome": os.homedir(),
		"arch": process.arch === "arm64" ? "arm64" : "amd64",
		"workspaceFolder": vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '',
		"workspaceFolderBasename": vscode.workspace.workspaceFolders ? path.basename(vscode.workspace.workspaceFolders[0].uri.fsPath) : '',
		"file": vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.fsPath : '',
		"fileWorkspaceFolder": vscode.window.activeTextEditor ? (vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri) || {}).uri?.fsPath : '', "relativeFile": vscode.window.activeTextEditor ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri.fsPath) : '',
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

	const resolveValue = (value: any): any => {
		if (typeof value === 'string') {
			for (let variable in variables) {
				value = value.replace('${' + variable + '}', (variables as Record<string, string>)[variable]);
			}
		} else if (Array.isArray(value)) {
			value = value.map(resolveValue);
		} else if (typeof value === 'object' && value !== null) {
			value = lodash.cloneDeep(value);
			for (let key in value) {
				value[key] = resolveValue(value[key]);
			}
		}

		return value;
	};

	let resolvedValue = resolveValue(value);
	const resolvedConfig = resolveValue(config);

	for (const key of Object.keys(resolvedConfig)) {
		if (!resolvedValue[key]) {
			resolvedValue[key] = resolvedConfig[key];
		}
	}

	return resolvedValue;
}

export function loadConfig(): [string, string, any] {
	const workspaceFolder = (vscode.workspace.workspaceFolders || [])[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('Please open a workspace first.');
		return ['', '', null];
	}
	const configPath = getConfigFilePath();
	const configContent = fs.readFileSync(configPath, 'utf-8');
	const config = JSON.parse(configContent);
	return [workspaceFolder.uri.fsPath, configPath, config];
}

export function createOrGetTask(symbolName: string, pkgPath: string, templateType: string): any {
	const confFile = getConfigFilePath();
	const config = JSON.parse(fs.readFileSync(confFile, 'utf8'));
	const tasks = (templateType === 'build' ? config.buildTasks : config.testTasks) || [];
	const taskTemplate = templateType === 'build' ? config.buildTemplate : config.testTemplate;
	const taskName = templateType === 'build' ? `${taskTemplate.name} ${pkgPath}` : `${taskTemplate.name} ${pkgPath}.${symbolName}`;

	const taskIndex = tasks.findIndex((task: { name: string }) => task.name === taskName);
	if (taskIndex > -1) {
		const oldTask = tasks[taskIndex];
		return oldTask;
	}

	let newTask = { ...taskTemplate, name: taskName, targetDir: path.join(config.global.targetDir, pkgPath) };
	if (templateType === 'test') {
		newTask.testName = symbolName;
	}
	tasks.push(newTask);
	if (templateType === 'build') {
		config.buildTasks = tasks;
	} else {
		config.testTasks = tasks;
	}
	fs.writeFileSync(confFile, JSON.stringify(config, null, 2), 'utf8');

	return newTask;
}