import hashlib,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import common_population as common
from streamed_json_object import read_object

class StreamedJsonTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'diagnostics.json'

    def read(self, text, *, chunk=3, expected=None, discard=frozenset({'zone_fits'})):
        self.path.write_bytes(text.encode('utf-8'))
        return read_object(self.path, decode=common._json, validate=common._reject_credentials,
                           discard_arrays=discard,chunk_chars=chunk,expected_file=expected)

    def test_array_streaming_retains_other_values_and_unicode(self):
        text=' {"zone_fits":[{"weights":[12,1.2e-25],"label":"é\\\""},null,true,[]],"keep":{"a":[1,2]},"n":123456} \r\n'
        self.assertEqual(self.read(text), {'keep':{'a':[1,2]},'n':123456})
        self.assertEqual(self.read(text,discard=frozenset()),json.loads(text))

    def test_empty_object_and_arrays(self):
        self.assertEqual(self.read('{}'),{})
        self.assertEqual(self.read('{"zone_fits":[],"keep":[]}'),{'keep':[]})

    def test_duplicate_root_refused(self):
        with self.assertRaisesRegex(ValueError,'duplicate'):
            self.read('{"zone_fits":[],"zone_fits":[]}')

    def test_duplicate_inside_discarded_array_refused(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            self.read('{"zone_fits":[{"x":1,"x":2}]}')

    def test_nonfinite_inside_discarded_array_refused(self):
        with self.assertRaisesRegex(ValueError,'Nonfinite'):
            self.read('{"zone_fits":[NaN]}')

    def test_credentials_inside_discarded_array_refused(self):
        with self.assertRaisesRegex(ValueError,'Credentials'):
            self.read('{"zone_fits":[{"secret":"bad"}]}')

    def test_root_credential_key_refused(self):
        with self.assertRaisesRegex(ValueError,'Credentials'):
            self.read('{"secret":[]}')

    def test_trailing_content_refused(self):
        with self.assertRaisesRegex(ValueError,'Trailing'):
            self.read('{"zone_fits":[]} false')

    def test_malformed_delimiters_and_values_refused(self):
        for text in ['[]','{"zone_fits":[1,]}','{"zone_fits":[1}','{"x":1,}','{"x" 1}','{"x":1e}','{"x":"unterminated}']:
            with self.subTest(text=text),self.assertRaises(ValueError):self.read(text)

    def test_exact_stream_hash_and_byte_length(self):
        text='{"zone_fits":["é"],"a":1}\r\n'
        data=text.encode('utf-8');d={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
        self.assertEqual(self.read(text,expected=d),{'a':1})
        with self.assertRaisesRegex(ValueError,'identity'):
            self.read(text,expected={**d,'sha256':'0'*64})
        with self.assertRaisesRegex(ValueError,'identity'):
            self.read(text,expected={**d,'bytes':len(data)+1})

    def test_all_discarded_elements_validated_separately(self):
        text=json.dumps({'zone_fits':[{'weights':list(range(10))} for _ in range(20)],'keep':2})
        self.path.write_text(text)
        sizes=[]
        def decode(raw):
            sizes.append(len(raw));return common._json(raw)
        result=read_object(self.path,decode=decode,validate=common._reject_credentials,discard_arrays=frozenset({'zone_fits'}),chunk_chars=11)
        self.assertEqual(result,{'keep':2})
        self.assertEqual(sum(size>20 for size in sizes),20)
        self.assertLess(max(sizes),100)

if __name__=='__main__':unittest.main()
