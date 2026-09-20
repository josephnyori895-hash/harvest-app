-- Preserve existing messages as read when per-user receipts are introduced.
-- New messages will be unread until the recipient/member explicitly marks
-- the conversation as seen.
INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at)
SELECT m.id, u.id, m.created_at
FROM messages m
JOIN users u
WHERE
  (
    m.conversation_key LIKE 'harvest:chat:%'
    AND u.username = m.recipient_username
  )
  OR (
    m.conversation_key LIKE 'group:%'
    AND EXISTS (
      SELECT 1
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE 'group:' || g.slug = m.conversation_key
        AND gm.user_id = u.id
    )
  )
  OR (
    m.conversation_key LIKE 'department:%'
    AND EXISTS (
      SELECT 1
      FROM departments d
      JOIN department_members dm ON dm.department_id = d.id
      WHERE 'department:' || d.slug = m.conversation_key
        AND dm.user_id = u.id
    )
  );
