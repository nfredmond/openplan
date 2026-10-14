"""Prepare private original-file descriptors for a later delivery adapter."""
import copy
import hashlib
import time

from admission_journal import private, synchronize
import contract
from retained_output_archive import clear_unpublished
from retained_source import json_bytes, publish, read_json, writer
from retained_task_observation import finite_number
from runtime_georef import Inspection

FORMAT = 'openplan.odm-private-artifact-plan.v1'
CONTENT_TYPES = {
    'orthomosaic': 'image/tiff', 'dsm': 'image/tiff', 'dtm': 'image/tiff',
    'point_cloud': 'application/octet-stream',
}
LIMITS = {
    'processingQualityVerification': 'unassessed',
    'requestedDeliverableCompletenessVerification': 'unassessed',
    'mapPlacementVerification': 'unassessed',
    'callbackPermission': False, 'publicationPermission': False,
}


class ArtifactPlan:
    def __init__(self, inspection, *, timeout=120):
        if not isinstance(inspection, Inspection) or not finite_number(timeout) or timeout <= 0:
            raise ValueError('Artifact preparation requires original inspection and a finite positive timeout')
        self.inspection = inspection
        self.timeout = timeout

    def advance(self, request_id, observation_hash):
        """Bind descriptors to checked originals before retaining a completion receipt."""
        inspected = self.inspection.advance(request_id, observation_hash)
        deadline = time.monotonic()+self.timeout
        products = self.inspection.products
        intake = products.intake
        products._check(request_id, deadline)
        root, engine = intake.observer._original(request_id, deadline)
        dispatch = intake.observer.reader.dispatch
        original = dispatch.load(request_id, deadline=deadline)
        # Inspection already verified product bytes. Load that exact immutable receipt.
        sources = read_json(root/'private-products', 'receipt.json')
        if hashlib.sha256(json_bytes(sources)).hexdigest() != inspected['receipt']['sourceReceiptSha256']:
            raise ValueError('Artifact preparation original product receipt differs')
        rows = []
        for row, tags in zip(sources['products'], inspected['report']['products']):
            if row['kind'] not in contract.ARTIFACT_KINDS or row['kind'] not in CONTENT_TYPES:
                raise ValueError('Artifact preparation has no supported original descriptor')
            rows.append({'kind': row['kind'], 'filename': row['filename'],
                'availability': row['availability'], 'reason': row['reason'],
                'sizeBytes': row['bytes'], 'checksumSha256': row['sha256'],
                'contentType': CONTENT_TYPES[row['kind']],
                'localRelativePath': 'private-products/objects/'+row['filename']
                    if row['availability'] == 'retained' else None,
                'nativeInspectionStatus': tags['status']})
        manifest = {'format': FORMAT, 'scope': 'private_original_artifact_preparation',
            'binding': {'installationId': dispatch.runtime.installation['installationId'],
                'targetId': dispatch.target, 'requestId': request_id,
                'jobReference': original['binding']['jobReference'],
                'originalApplicationJob': copy.deepcopy(original['applicationJob']),
                'originalDispatchSha256': original['payloadSha256'],
                'originalTaskUuid': engine['taskUuid'], 'observationSha256': observation_hash},
            'productReceiptSha256': inspected['receipt']['sourceReceiptSha256'],
            'inspectionReceiptSha256': hashlib.sha256(json_bytes(inspected['receipt'])).hexdigest(),
            'inspectionReportSha256': inspected['receipt']['reportSha256'],
            'artifacts': rows,
            'unselectedContractKinds': [kind for kind in contract.ARTIFACT_KINDS
                if kind not in {row['kind'] for row in rows}], **copy.deepcopy(LIMITS)}
        intake._access(request_id, deadline)
        products._check(request_id, deadline)
        pack = root/'private-artifact-plan'
        try:
            pack.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(pack, True)
        with writer(pack, deadline):
            clear_unpublished(pack)
            if not (pack/'manifest.json').exists() and any(
                    path.name != 'writer.lock' for path in pack.iterdir()):
                raise ValueError('Artifact preparation has no original manifest')
            publish(pack, 'manifest.json', json_bytes(manifest))
            products._check(request_id, deadline)
            intake._access(request_id, deadline)
            receipt = {'format': FORMAT, 'scope': 'private_original_artifact_preparation',
                'manifestSha256': hashlib.sha256(json_bytes(manifest)).hexdigest(),
                **copy.deepcopy(LIMITS)}
            publish(pack, 'receipt.json', json_bytes(receipt))
            products._check(request_id, deadline)
            return {'manifest': manifest, 'receipt': receipt}
