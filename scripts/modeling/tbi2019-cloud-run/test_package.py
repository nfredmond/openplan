"""Refuse altered archives before a caller can reach model execution."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import verify_archive as verifier


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = {'inputs/bundle/households.csv':b'household_id\n17\n','inputs/bundle/persons.csv':b'person_id\n99\n'}
        self.inventory = json.dumps({'files':[{'archive_path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
                                              for n,b in self.data.items()]}).encode()
        self.inv = self.root/'inventory.json'; self.inv.write_bytes(self.inventory)

    def archive(self, members=None):
        p = self.root/'archive.tar.gz'
        with tarfile.open(p,'w:gz') as out:
            for name, data in members or list(self.data.items())+[('archive-inventory.json',self.inventory)]:
                m = tarfile.TarInfo(name); m.size = len(data); out.addfile(m,io.BytesIO(data))
        return p

    def verify(self,p,sha=None):
        return verifier.verify_archive(p,self.inv,sha or verifier.digest(p),p.stat().st_size,self.root/'bundle')

    def test_valid_and_reordered_survivor(self):
        p = self.archive(list(reversed(list(self.data.items())))+[('archive-inventory.json',self.inventory)])
        self.assertEqual(self.verify(p)['verified_members'],3)
        self.assertEqual((self.root/'bundle/households.csv').read_bytes(),self.data['inputs/bundle/households.csv'])

    def test_wrong_archive_hash(self):
        with self.assertRaisesRegex(verifier.Refusal,'archive hash'): self.verify(self.archive(),'0'*64)
        self.assertFalse((self.root/'bundle').exists())

    def test_corrupt_member_with_correct_outer_hash(self):
        members=list(self.data.items()); members[0]=(members[0][0],b'household_id\n18\n')
        with self.assertRaisesRegex(verifier.Refusal,'member hash'): self.verify(self.archive(members+[('archive-inventory.json',self.inventory)]))

    def test_missing_member(self):
        with self.assertRaisesRegex(verifier.Refusal,'census'): self.verify(self.archive([('archive-inventory.json',self.inventory)]))

    def test_duplicate_member(self):
        members=list(self.data.items())+[('archive-inventory.json',self.inventory),('archive-inventory.json',self.inventory)]
        with self.assertRaisesRegex(verifier.Refusal,'unsafe'): self.verify(self.archive(members))

    def test_path_escape(self):
        with self.assertRaisesRegex(verifier.Refusal,'unsafe'): self.verify(self.archive([('../escape',b'x')]))
        self.assertFalse((self.root/'escape').exists())

    def test_embedded_inventory_changed(self):
        with self.assertRaisesRegex(verifier.Refusal,'member hash'): self.verify(self.archive(list(self.data.items())+[('archive-inventory.json',self.inventory.replace(b'17',b'18') if b'17' in self.inventory else b' '*len(self.inventory))]))

    def test_size_mismatch(self):
        with self.assertRaisesRegex(verifier.Refusal,'byte length'): self.verify(self.archive([('inputs/bundle/households.csv',b'x')]))


if __name__=='__main__': unittest.main()
