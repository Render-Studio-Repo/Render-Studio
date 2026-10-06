-- Compact product-control knowledge for Render Agent and other assistants.
-- Static controls use PostgreSQL full-text search. No embedding request is
-- needed, so button lookup adds no model cost and stays fast at small scale.
CREATE TABLE IF NOT EXISTS public.render_agent_controls (
  control_key text PRIMARY KEY,
  surface text NOT NULL,
  label text NOT NULL,
  action text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(label, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(surface, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(action, '') || ' ' || array_to_string(keywords, ' ')), 'C')
  ) STORED
);

CREATE INDEX IF NOT EXISTS render_agent_controls_search_idx
  ON public.render_agent_controls USING gin(search_document);
CREATE INDEX IF NOT EXISTS render_agent_controls_surface_idx
  ON public.render_agent_controls(surface);

ALTER TABLE public.render_agent_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS render_agent_controls_authenticated_read ON public.render_agent_controls;
CREATE POLICY render_agent_controls_authenticated_read ON public.render_agent_controls
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.search_render_agent_controls(search_query text, match_count int DEFAULT 8)
RETURNS SETOF public.render_agent_controls
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.* FROM public.render_agent_controls c
  WHERE c.search_document @@ websearch_to_tsquery('english', coalesce(search_query, ''))
  ORDER BY ts_rank_cd(c.search_document, websearch_to_tsquery('english', coalesce(search_query, ''))) DESC,
           c.control_key
  LIMIT greatest(1, least(coalesce(match_count, 8), 20));
$$;

GRANT SELECT ON public.render_agent_controls TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_render_agent_controls(text, int) TO authenticated, service_role;

INSERT INTO public.render_agent_controls (control_key, surface, label, action, keywords) VALUES
('robotics.connect_pi','Robotics Home','Connect Pi','Connect to the saved Raspberry Pi robotics API without enabling teleop or moving hardware.',ARRAY['raspberry pi','connect','api','robot bridge','offline']),
('robotics.open_cameras','Robotics Home','Open Cameras','Open the unified left wrist, right wrist, and ZED POV camera window.',ARRAY['camera','wrist','zed','pov','video','stream']),
('robotics.training_data','Robotics Home','Training data','Open robot datasets and synchronized episode artifacts.',ARRAY['dataset','lerobot','training','episodes','recording']),
('robotics.robot_files','Robotics Home','Robot files','Open the robotics-specific project file explorer.',ARRAY['files','explorer','artifacts','project']),
('robotics.mujoco','Robotics Home','MuJoCo','Open the simulation view. This does not move physical hardware.',ARRAY['mujoco','simulation','sim','cube test']),
('robotics.preflight','Robotics Home','Preflight','Run reset, calibration, limits, connection, and guarded-home checks before a physical run.',ARRAY['preflight','calibration','limits','hardware','sync']),
('robotics.home','Robotics Home','Home robot','Stop motion producers and slowly move both arms to the feedback-checked arms-down home pose after confirmation.',ARRAY['home','arms down','reset','safe pose']),
('robotics.recover_home','Robotics Home','Recover home','Clear a latched software stop only through the guarded recovery and home sequence after confirmation.',ARRAY['recover','kill latch','home','reset']),
('robotics.kill','Robotics Home','KILL / DISABLE NOW','Immediately stop teleop, emotes, playback, and motion producers and disable the robot. This is the only immediate physical assistant action.',ARRAY['kill','disable','emergency stop','e-stop','teleop','emote']),
('robotics.hey_ai','Robotics Home header','Hey AI','Start the shared voice assistant. Robotics reasoning uses the AI prompt model and prefers the selected connected subscription.',ARRAY['voice','assistant','hey ai','astra','model','subscription']),
('robotics.agent_settings','Robotics Home header','Voice settings','Open voice model, realtime voice, volume, wake name, and context-sharing settings.',ARRAY['gear','settings','voice model','volume','wake name']),
('robotics.render_agent','Robotics Home header','Render Agent','Open actionable robotics chat with the active project and indexed Robotics Home controls in context.',ARRAY['render agent','chat','questions','actions','robotics'])
ON CONFLICT (control_key) DO UPDATE SET
  surface = EXCLUDED.surface,
  label = EXCLUDED.label,
  action = EXCLUDED.action,
  keywords = EXCLUDED.keywords,
  updated_at = now();
