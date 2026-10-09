"""Directed exclusion certificates compared with exhaustive reachability."""
import unittest

from excluded_paths_candidate import verify


def edges(pairs,cost=1.):
    return [(a,b,cost,i+1,1) for i,(a,b) in enumerate(pairs)]


class ExcludedGraphTests(unittest.TestCase):
    def test_dead_ends_cycles_and_disconnected_components_are_safe(self):
        record=verify(edges([(1,10),(10,1),(10,11),(11,10),(20,21),(21,20)]),{1,2})
        self.assertEqual(record['status'],'matched')
        self.assertEqual(record['excluded_direction_count'],6)
        self.assertEqual(record,verify(list(reversed(edges([(1,10),(10,1),(10,11),(11,10),(20,21),(21,20)]))),{2,1}))

    def test_two_origins_converging_at_a_dead_end_do_not_form_a_route(self):
        self.assertEqual(verify(edges([(1,10),(2,10)]),{1,2})['status'],'matched')

    def test_route_between_distinct_anchors_refuses(self):
        with self.assertRaisesRegex(ValueError,'connects distinct'):
            verify(edges([(1,10),(10,11),(11,2)]),{1,2})

    def test_negative_or_nonfinite_costs_refuse_even_on_a_closed_walk(self):
        for cost in (-1.,float('nan'),float('inf')):
            with self.subTest(cost=cost),self.assertRaisesRegex(ValueError,'finite and nonnegative'):
                verify(edges([(1,10),(10,1)],cost),{1})
        self.assertEqual(verify(edges([(1,10),(10,1)],0.),{1})['status'],'matched')

    def test_two_origin_label_bound_matches_exhaustive_four_node_graphs(self):
        pairs=[(a,b) for a in range(4) for b in range(4) if a!=b]
        for mask in range(1<<len(pairs)):
            selected=[edge for i,edge in enumerate(pairs) if mask&(1<<i)]
            reachable=[[a==b for b in range(4)] for a in range(4)]
            for a,b in selected:reachable[a][b]=True
            for via in range(4):
                for a in range(4):
                    for b in range(4):reachable[a][b]|=reachable[a][via] and reachable[via][b]
            for anchors in ({0,1},{0,1,3}):
                expected=any(a!=b and reachable[a][b] for a in anchors for b in anchors)
                try:verify(edges(selected),anchors)
                except ValueError as error:
                    self.assertIn('connects distinct',str(error));refused=True
                else:refused=False
                self.assertEqual(refused,expected,f'mask={mask}, anchors={anchors}')


if __name__=='__main__':unittest.main()
