import unittest
import pexpect
import os
import tempfile
import shutil

class TestScripts(unittest.TestCase):
    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        self.test_dir = tempfile.mkdtemp()
        
        # Copy scripts to a temporary directory so we don't clobber the real config files
        shutil.copytree(os.path.join(self.repo_root, 'dist', 'scripts'), os.path.join(self.test_dir, 'scripts'))
        with open(os.path.join(self.test_dir, 'VERSION'), 'w') as f:
            f.write('0.3')
        
        os.makedirs(os.path.join(self.test_dir, 'skills', 'dashboard-creator'))

        # Mock install-manifest.py to not actually hit the API
        mock_install = os.path.join(self.test_dir, 'scripts', 'install-manifest.py')
        with open(mock_install, 'w') as f:
            f.write("print('Mock install-manifest')")
            
    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_bootstrap_interactive(self):
        bootstrap_script = os.path.join(self.test_dir, 'scripts', 'bootstrap.sh')
        
        # Use pexpect to run the script in a PTY and interact with it
        child = pexpect.spawn('bash', [bootstrap_script], encoding='utf-8', timeout=5)
        
        # [2/5] Toolbox (conditionally prompts if not installed)
        index = child.expect([r'Download it now from googleapis/mcp-toolbox\?', r'Looker instance URL.*:'])
        if index == 0:
            child.sendline('n')
            child.expect(r'Looker instance URL.*:')
        
        child.sendline('https://mylooker.com')
        
        child.expect(r'Looker API client_id:')
        child.sendline('test_client_id')
        
        child.expect(r'Looker API client_secret:')
        child.sendline('test_client_secret')
        
        child.expect(r'Does your Looker instance require an SSO proxy\?')
        child.sendline('n')
        
        # [3/5] Skill Config
        child.expect(r'Default LookML model.*:')
        child.sendline('test_model')
        
        child.expect(r'Default explore in that model.*:')
        child.sendline('test_explore')
        
        child.expect(r'Looker folder ID to publish dashboards into.*:')
        child.sendline('99')
        
        child.expect(r'LookML project name to create in Looker.*:')
        child.sendline('test_project')
        
        # Let the script finish
        child.expect(r'Done.', timeout=10)
        
        # Verify the generated configurations
        self.assertTrue(os.path.exists(os.path.join(self.test_dir, 'looker-config.json')))
        
        import json
        with open(os.path.join(self.test_dir, 'looker-config.json')) as f:
            looker_cfg = json.load(f)
            self.assertEqual(looker_cfg['base_url'], 'https://mylooker.com')
            self.assertEqual(looker_cfg['client_id'], 'test_client_id')
            self.assertEqual(looker_cfg['client_secret'], 'test_client_secret')

        self.assertTrue(os.path.exists(os.path.join(self.test_dir, 'skills', 'dashboard-creator', 'config.json')))
        
        with open(os.path.join(self.test_dir, 'skills', 'dashboard-creator', 'config.json')) as f:
            skill_cfg = json.load(f)
            self.assertEqual(skill_cfg['looker_instance_url'], 'https://mylooker.com')
            self.assertEqual(skill_cfg['default_model'], 'test_model')
            self.assertEqual(skill_cfg['default_explores'], ['test_explore'])
            self.assertEqual(skill_cfg['publish_folder_id'], '99')

if __name__ == '__main__':
    unittest.main()
