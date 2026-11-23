UPDATE `safe_tokens` SET `kind` = 'operator' WHERE `kind` = 'supervisor';--> statement-breakpoint
UPDATE `safe_tokens` SET `scopes_json` = REPLACE(REPLACE(`scopes_json`, 'supervisor:read', 'operator:read'), 'supervisor:write', 'operator:write') WHERE `scopes_json` LIKE '%supervisor:%';--> statement-breakpoint
UPDATE `state_transitions` SET `actor_kind` = 'operator' WHERE `actor_kind` = 'supervisor';--> statement-breakpoint
UPDATE `incidents` SET `triage_owner` = 'operator' WHERE `triage_owner` = 'supervisor';
