-- Reserved for future in-app notifications; not yet wired to any route.

CREATE TABLE notifications (
  notification_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(50)  NOT NULL,
  title              VARCHAR(200) NOT NULL,
  message            TEXT         NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
