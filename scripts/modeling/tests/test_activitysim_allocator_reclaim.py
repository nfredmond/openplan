import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from activitysim_allocator_reclaim import reclaim_before

class ReclaimTests(unittest.TestCase):
    def test_order_identity_and_exactly_one_call(self):
        events=[];arg=object();kw=object();result=object()
        def original(value,*,named):
            events.append('original');self.assertIs(value,arg);self.assertIs(named,kw);return result
        wrapped=reclaim_before(original,lambda:events.append('reclaim'))
        self.assertIs(wrapped(arg,named=kw),result)
        self.assertEqual(events,['reclaim','original'])
        self.assertEqual(wrapped.__name__,original.__name__)

    def test_original_exception_is_preserved(self):
        expected=RuntimeError('original')
        def original():raise expected
        try:reclaim_before(original,lambda:None)()
        except RuntimeError as actual:self.assertIs(actual,expected)
        else:self.fail('Original error disappeared')

    def test_reclaim_failure_prevents_unadmitted_execution(self):
        called=[]
        def reclaim():raise RuntimeError('reclaim failed')
        with self.assertRaisesRegex(RuntimeError,'reclaim failed'):
            reclaim_before(lambda:called.append(1),reclaim)()
        self.assertEqual(called,[])

if __name__=='__main__':unittest.main()
