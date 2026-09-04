create index if not exists notifications_user_unread_reply_idx
on public.notifications (user_id, created_at desc)
where read_at is null and kind = 'reply';
