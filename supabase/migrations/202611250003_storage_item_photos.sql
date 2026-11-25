-- FOUNDIT Phase B Migration 3: Private Supabase Storage Bucket & Policies (item-photos)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-photos',
  'item-photos',
  false,
  2097152, -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Allow authenticated users to retrieve signed URLs for item photos
CREATE POLICY "item_photos_authenticated_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'item-photos');

-- Allow active authenticated users to upload only under their own user_id prefix: <uid>/<item_id>/<file>
CREATE POLICY "item_photos_authenticated_upload_own_folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'item-photos'
    AND public.is_active_user()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow owners or admins to delete uploaded item photos
CREATE POLICY "item_photos_delete_own_or_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'item-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );
