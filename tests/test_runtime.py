import unittest
from playwright.sync_api import sync_playwright
import os

class TestRuntime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.page = cls.browser.new_page()
        
        # Start on a blank page
        cls.page.goto('about:blank')
        
        # Inject our vanilla JS files into the page context
        runtime_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'runtime'))
        cls.page.add_script_tag(path=os.path.join(runtime_dir, 'host-common.js'))
        cls.page.add_script_tag(path=os.path.join(runtime_dir, 'canvas-dashboard.js'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def test_loadDashboardFromHTML(self):
        # We evaluate JS in the context of the browser
        self.page.evaluate('''() => {
            const container = document.createElement('div');
            container.id = 'dashboard-container';
            document.body.appendChild(container);
            
            const html = `
                <div class="test-dash">Hello Web Components</div>
                <script>window.testScriptExecuted = true;</script>
            `;
            
            // This is the function from host-common.js
            window.canvasDashboard.loadDashboardFromHTML({ html: html, container: container });
        }''')
        
        # Check if the DOM structure was successfully injected
        content = self.page.evaluate("document.querySelector('#dashboard-container .test-dash').textContent")
        self.assertEqual(content, "Hello Web Components")
        
        # Critical test: `loadDashboardFromHTML` rips out <script> tags and re-inserts them so they execute.
        # innerHTML = '<script>' normally does NOT execute. Let's make sure our script executed.
        script_executed = self.page.evaluate("window.testScriptExecuted")
        self.assertTrue(script_executed)

    def test_canvas_dashboard_element(self):
        # Let's test the custom elements defined in canvas-dashboard.js
        self.page.evaluate('''() => {
            const dash = document.createElement('canvas-dashboard');
            dash.id = 'my-canvas';
            document.body.appendChild(dash);
        }''')
        
        # Verify the custom element was registered successfully and has its methods
        is_defined = self.page.evaluate("customElements.get('canvas-dashboard') !== undefined")
        self.assertTrue(is_defined)
        
        # Verify it has the methods defined on CanvasDashboard prototype
        has_method = self.page.evaluate("typeof document.querySelector('#my-canvas').getFilters === 'function'")
        self.assertTrue(has_method)

if __name__ == '__main__':
    unittest.main()
