"""Create the synthetic text-layer PDF used only by the recovery proof."""
import os
from pathlib import Path
import sys

from reportlab.pdfgen import canvas

os.umask(0o077)
target = Path(sys.argv[1])
if target.exists():
    raise FileExistsError('Use a fresh fixture destination')
pdf = canvas.Canvas(str(target), pagesize=(612, 792), invariant=1)
pdf.setTitle('Synthetic worker recovery fixture')
pdf.setAuthor('OpenPlan engineering fixture')
for index, line in enumerate(('Synthetic page one: retained input.', None,
                              'Synthetic page three: original result.')):
    if line is not None:
        pdf.setFont('Helvetica', 14)
        pdf.drawString(54, 720, line)
        pdf.setFont('Helvetica', 10)
        pdf.drawString(54, 696, 'Engineering fixture. No agency record or accuracy claim.')
        pdf.drawString(54, 54, f'Page {index + 1} of 3')
    pdf.showPage()
pdf.save()
with target.open('rb') as stream:
    os.fsync(stream.fileno())
