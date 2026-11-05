#!/usr/bin/env python3
"""Second-review checks: run with python3 -I tests/review-checks.py -v.

Temporary fixtures stay inside this repository and are removed after each test.
CC_TYPES and TSC have the same meaning as in tests/typecheck.sh.
"""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def declarations():
    # The same default as tests/typecheck.sh, so the fixture needs no CC_TYPES either.
    types = os.environ.get('CC_TYPES') or ROOT / '.claude-plugin/types/claude-code/index.d.ts'
    return pathlib.Path(types).resolve()


class TypecheckReview(unittest.TestCase):
    def check_bad_file(self, folder):
        with tempfile.TemporaryDirectory(prefix='.review-check-', dir=ROOT) as tmp:
            root = pathlib.Path(tmp)
            (root / 'hooks').mkdir()
            (root / 'tests').mkdir()
            shutil.copyfile(ROOT / 'tests/typecheck.sh', root / 'tests/typecheck.sh')
            (root / 'hooks/register.ts').write_text('export const valid = 1\n', encoding='utf-8')
            (root / folder / 'bad.test.ts').write_text(
                'export const bad: number = "text"\n', encoding='utf-8')
            result = subprocess.run(
                ['sh', 'tests/typecheck.sh'], cwd=root, text=True, capture_output=True,
                env={
                    'PATH': os.environ.get('PATH', os.defpath),
                    'CC_TYPES': str(declarations()),
                    **({'TSC': os.environ['TSC']} if 'TSC' in os.environ else {}),
                },
                check=False,
            )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('TS2322', result.stdout + result.stderr)

    def test_rejects_type_error_in_tests(self):
        self.check_bad_file('tests')

    def test_comparison_rejects_same_type_error_in_hooks(self):
        self.check_bad_file('hooks')


class PreviewReview(unittest.TestCase):
    def check_preview(self, root):
        sources = sorted(p.parent.name for p in (root / '.agents/skills').glob('*/SKILL.md'))
        copies = sorted(p.parent.name for p in (root / '.claude/skills').glob('*/SKILL.md'))
        self.assertEqual((sources, copies), (['house-style'], ['release-notes']))

    def test_preview_matches_its_readme_and_catalog(self):
        self.check_preview(ROOT / 'preview/project')

    def test_comparison_project_with_only_the_documented_source_skill(self):
        with tempfile.TemporaryDirectory(prefix='.review-check-', dir=ROOT) as tmp:
            root = pathlib.Path(tmp)
            skill = root / '.agents/skills/house-style/SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text('---\nname: house-style\ndescription: d\n---\nx\n', encoding='utf-8')
            skill = root / '.claude/skills/release-notes/SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text('---\nname: release-notes\ndescription: d\n---\nx\n', encoding='utf-8')
            self.check_preview(root)


if __name__ == '__main__':
    unittest.main()
