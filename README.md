<div align="center">
  <img src="https://raw.githubusercontent.com/pallaprolus/dev-scholar/main/images/banner.png" alt="DevScholar Banner" width="100%">
</div>

# DevScholar

<div align="center">

[![Installs](https://img.shields.io/visual-studio-marketplace/i/pallaprolus.dev-scholar)](https://marketplace.visualstudio.com/items?itemName=pallaprolus.dev-scholar)
[![Version](https://img.shields.io/visual-studio-marketplace/v/pallaprolus.dev-scholar)](https://marketplace.visualstudio.com/items?itemName=pallaprolus.dev-scholar)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/pallaprolus.dev-scholar)](https://marketplace.visualstudio.com/items?itemName=pallaprolus.dev-scholar)

**Your Code, Connected to Knowledge.**
<br>
Automatically link, preview, and manage research papers (arXiv, DOI, Semantic Scholar) directly inside VS Code.

</div>

## ✨ Features

### 🔍 Smart Parsing
DevScholar automatically detects research paper references in your code comments. Whether it's an arXiv ID (`arxiv:1706.03762`), a DOI (`doi:10.1038/nature14539`), or a Semantic Scholar ID, DevScholar finds it and provides instant context.

### 📜 Hover Previews
Simply hover over any detected reference to see a rich preview card containing:
- Paper Title
- Authors
- Publication Year & Journal
- Abstract/Summary
- Links to PDF, arXiv, and DOI
- Quick Actions (Copy Citation, Open in Browser)

### 📚 Bibliography Export
Generate bibliographies effortlessly from the papers referenced in your current file.
- **Formats**: BibTeX, APA, Chicago
- **Command**: `DevScholar: Export Bibliography`

### 🔄 Zotero Integration
Sync detected papers directly to your Zotero library for long-term management.
- **Command**: `DevScholar: Sync with Zotero`

## 🚀 Usage

### Supported Formats
DevScholar recognizes references in comments in the following formats:

- **arXiv**: `arxiv:1234.5678`, `arXiv:2101.00001`
- **DOI**: `doi:10.1145/3448016.3452838`
- **Semantic Scholar**: `S2:e07b3...`

### Commands
All commands are prefixed with `DevScholar`:

- `DevScholar: Parse Research Papers in Current File`: Force a re-scan of the current file.
- `DevScholar: Export Bibliography`: Copy a formatted bibliography to your clipboard.
- `DevScholar: Sync with Zotero`: Add referenced papers to your Zotero collection.
- `DevScholar: Show Paper Version History`: Track paper references across Git commits.

## ⚙️ Configuration

| Setting | Default | Description |
| str | str | str |
| --- | --- | --- |
| `devscholar.autoParseOnSave` | `true` | Automatically parse references when saving. |
| `devscholar.showCodeLens` | `true` | Show CodeLens actions above paper references. |
| `devscholar.showDecorations` | `true` | Underline detected paper references. |
| `devscholar.zoteroEnabled` | `false` | Enable Zotero syncing features. |

## 📦 Installation

Install directly from the VS Code Marketplace or build from source:

1. Clone the repository
2. Run `npm install`
3. Press `F5` to start debugging

## 📄 License
MIT
