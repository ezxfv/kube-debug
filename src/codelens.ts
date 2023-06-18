import * as vscode from 'vscode';

export class GoCodeLensProvider implements vscode.CodeLensProvider {
	async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
		const flatSymbols = this.flattenSymbols(symbols || [], document.uri);

		let codelenses: vscode.CodeLens[] = [];
		for (let symbol of flatSymbols) {
			if (symbol.name === 'main' || symbol.name.startsWith('Test')) {
				const range = symbol.location.range;
				const runCommand: vscode.Command = {
					command: symbol.name === 'main' ? 'kube-debug.clickRunMain' : 'kube-debug.clickRunTest',
					title: 'Kube Run',
					arguments: [symbol.name, document.uri.fsPath]
				};
				const debugCommand: vscode.Command = {
					command: symbol.name === 'main' ? 'kube-debug.clickDebugMain' : 'kube-debug.clickDebugTest',
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