"""Malformed persisted factor maps must not become a baseline network."""
import unittest

from assignment_settings import AssignmentSettingsError
from network_settings import assignment_network_settings, canonical_network_settings


class NetworkSettingsTests(unittest.TestCase):
    def test_explicit_empty_map_and_builder_default_are_baseline(self):
        baseline=assignment_network_settings()
        self.assertEqual(assignment_network_settings({}),baseline)
        self.assertEqual(canonical_network_settings(baseline),baseline)
        self.assertEqual(baseline['road_class_factors'],{})

    def test_persisted_non_objects_never_select_baseline(self):
        for value in (None,False,0,'',[],True,1,'primary',[['primary',1.2]]):
            record=assignment_network_settings()
            record['road_class_factors']=value
            with self.subTest(value=value),self.assertRaisesRegex(AssignmentSettingsError,'Persisted.*object'):
                canonical_network_settings(record)

    def test_builder_rejects_non_objects_with_domain_error(self):
        for value in (False,0,'',[],True,1,'primary',[['primary',1.2]]):
            with self.subTest(value=value),self.assertRaisesRegex(AssignmentSettingsError,'factors must be an object'):
                assignment_network_settings(value)

    def test_valid_factors_are_canonical_without_changing_input(self):
        source={'secondary':'1.25','primary':2}
        record=assignment_network_settings(source)
        self.assertEqual(list(record['road_class_factors']),['primary','secondary'])
        self.assertEqual(record['road_class_factors'],{'primary':2.,'secondary':1.25})
        self.assertEqual(source,{'secondary':'1.25','primary':2})
        self.assertEqual(canonical_network_settings(record),record)

    def test_invalid_values_stay_invalid_in_an_object(self):
        for value in (False,None,0,-1,float('nan'),float('inf'),'unknown'):
            record=assignment_network_settings()
            record['road_class_factors']={'primary':value}
            with self.subTest(value=value),self.assertRaises(AssignmentSettingsError):
                canonical_network_settings(record)


if __name__=='__main__':unittest.main()
