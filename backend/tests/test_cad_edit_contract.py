import unittest

from backend.services.cad_edit_contract import CAD_EDIT_RULES, preserve_edit_baseline


class EditContractTests(unittest.TestCase):
    def test_rewrite_retains_selected_file_and_complete_model_scope(self):
        result = preserve_edit_baseline("Extend @face-1 by 70 mm.", "cradle.step", max_chars=10000)
        self.assertIn("@face-1 by 70 mm", result)
        self.assertIn('"cradle.step"', result)
        self.assertIn("whole edited model, not an isolated new feature", result)
        self.assertIn("original units", result)

    def test_length_limit_does_not_truncate_edit_contract(self):
        result = preserve_edit_baseline("x" * 10000, "cradle.step", max_chars=1200)
        self.assertLessEqual(len(result), 1200)
        self.assertTrue(result.endswith("viewport or printer."))

    def test_explicit_user_dimension_changes_remain_allowed(self):
        self.assertIn("unless the user explicitly changes them", CAD_EDIT_RULES)
        self.assertIn("not the overall model size", CAD_EDIT_RULES)
        self.assertIn("indices are localization hints, not CAD face IDs", CAD_EDIT_RULES)


if __name__ == "__main__":
    unittest.main()
