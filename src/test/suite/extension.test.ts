import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        const extension = vscode.extensions.getExtension('pallaprolus.dev-scholar');
        assert.ok(extension, 'Extension should be installed');
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('pallaprolus.dev-scholar');
        if (extension) {
            await extension.activate();
            assert.strictEqual(extension.isActive, true, 'Extension should be active');
        }
    });

    suite('Commands Registration', () => {
        test('should register searchPapers command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.searchPapers'), 'searchPapers command should exist');
        });

        test('should register parseCurrentFile command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.parseCurrentFile'), 'parseCurrentFile command should exist');
        });

        test('should register exportBibliography command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.exportBibliography'), 'exportBibliography command should exist');
        });

        test('should register syncWithZotero command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.syncWithZotero'), 'syncWithZotero command should exist');
        });

        test('should register syncWithMendeley command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.syncWithMendeley'), 'syncWithMendeley command should exist');
        });

        test('should register clearCache command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.clearCache'), 'clearCache command should exist');
        });

        test('should register showAllPapers command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.showAllPapers'), 'showAllPapers command should exist');
        });

        test('should register previewPdf command', async () => {
            const commands = await vscode.commands.getCommands(true);
            assert.ok(commands.includes('devscholar.previewPdf'), 'previewPdf command should exist');
        });
    });

    suite('Configuration', () => {
        test('should have configuration settings', () => {
            const config = vscode.workspace.getConfiguration('devscholar');
            assert.ok(config, 'Configuration should exist');
        });

        test('should have autoParseOnSave setting', () => {
            const config = vscode.workspace.getConfiguration('devscholar');
            const value = config.get('autoParseOnSave');
            assert.strictEqual(typeof value, 'boolean', 'autoParseOnSave should be boolean');
        });

        test('should have showCodeLens setting', () => {
            const config = vscode.workspace.getConfiguration('devscholar');
            const value = config.get('showCodeLens');
            assert.strictEqual(typeof value, 'boolean', 'showCodeLens should be boolean');
        });

        test('should have cacheMaxAge setting', () => {
            const config = vscode.workspace.getConfiguration('devscholar');
            const value = config.get('cacheMaxAge');
            assert.strictEqual(typeof value, 'number', 'cacheMaxAge should be number');
        });
    });
});
