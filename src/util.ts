import * as vscode from 'vscode';
import * as child_process from 'child_process';


export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

const outputChannels = new Map();
export function getOrCreateOutputChannel(name: string) {
	if (!outputChannels.has(name)) {
		outputChannels.set(name, vscode.window.createOutputChannel(name));
	}
	let outputChannel = outputChannels.get(name);
	outputChannel.show(true);
	return outputChannel;
}

export function execAsync(command: string, envVars: Record<string, string> = {}, outputChannelName?: string) {
	console.log(`exec: ${command}`);
	if (outputChannelName) {
		console.log(`output: ${outputChannelName}`);
	}

	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const options = {
			env: {
				...process.env,
				...envVars
			}
		};

		const child = child_process.exec(command, options);

		let stdout = '';
		let stderr = '';

		if (outputChannelName) {
			// Get or create output channel
			let outputChannel = getOrCreateOutputChannel(outputChannelName);

			if (child.stdout) {
				child.stdout.on('data', (data) => {
					stdout += data.toString();
					outputChannel.append(data.toString());
				});
			}

			if (child.stderr) {
				child.stderr.on('data', (data) => {
					stderr += data.toString();
					outputChannel.append(data.toString());
				});
			}
		} else {
			if (child.stdout) {
				child.stdout.on('data', (data) => {
					stdout += data.toString();
				});
			}

			if (child.stderr) {
				child.stderr.on('data', (data) => {
					stderr += data.toString();
				});
			}
		}

		child.on('error', (error) => {
			reject(error);
		});

		child.on('exit', (code, signal) => {
			if (code !== 0) {
				reject(new Error(`Exited with ${code || signal}`));
				return;
			}

			resolve({ stdout, stderr });
		});
	});
}