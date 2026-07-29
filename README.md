# Canvas Dashboards (Developer Repository)

This is the monorepo for Canvas Dashboards. 

## Repository Structure

To keep the shipped artifacts clean from developer tooling, this repository is organized into two primary areas:

- **`dist/`**: The actual payload shipped to the customer. Everything inside this directory gets bundled into the `.tar.gz` archive distributed via GitHub Pages. The customer-facing `README.md` lives inside this directory.
- **`tests/` & Root**: Developer infrastructure. This includes GitHub Actions, test scripts, and this developer README.

## Local Development

This repository maintains a deliberately lightweight, **Node.js-free** development environment. There is no `package.json` or `node_modules`. All testing and tooling relies purely on Python and standard bash.

### Running Tests

To run the automated test suite locally, you only need Python 3 and a few pip dependencies:

```bash
pip3 install pexpect pytest-playwright playwright
python3 -m playwright install chromium
```

Run the tests using Python's standard `unittest`:
```bash
python3 -m unittest discover tests/
```

- **Shell Scripts**: Tested interactively using `pexpect` to safely simulate user terminal input (TTY) for the installer prompts without hanging.
- **Web Components**: Tested using `playwright` to evaluate the vanilla JavaScript natively in a real headless Chromium browser, completely avoiding the limitations of `jsdom`.
