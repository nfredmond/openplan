BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $$ DECLARE c uuid := 'b76fe95e-3a5e-4791-a232-dd65d85b8a57'; p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); e uuid; v timestamptz;
BEGIN
 INSERT INTO engagement_items(id,campaign_id,body,status) VALUES(p,c,'SYNTHETIC parent','approved') RETURNING updated_at INTO v;
 INSERT INTO engagement_items(id,campaign_id,body,status,parent_item_id) VALUES(r,c,'SYNTHETIC reply','approved',p);
 INSERT INTO engagement_closeloop_entries(campaign_id,theme_title,status,source_item_ids) VALUES(c,'SYNTHETIC parent withdrawal reproduction','published',ARRAY[r]) RETURNING id INTO e;
 UPDATE engagement_items SET status='rejected',review_expected_updated_at=v,review_reason='SYNTHETIC withhold parent' WHERE id=p;
 IF NOT EXISTS(SELECT 1 FROM engagement_closeloop_entries WHERE id=e AND status='published') THEN RAISE EXCEPTION 'Expected current parent-withdrawal defect was not reproduced'; END IF;
 RAISE NOTICE 'Current schema leaves reply-linked response published after its parent is withheld';
END $$;
ROLLBACK;
