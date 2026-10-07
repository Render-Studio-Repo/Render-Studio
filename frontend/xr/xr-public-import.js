/** Explicit public-room imports share a viewable asset, not another user's private project. */
export function createPublicProjectImporter({join,api,createShareUrl,getProjectId,getSelectedFile,getProjects,spawn}) {
  const pending = new Map();
  return function importSharedProject(id, {filename:requestedFile = ''} = {}) {
    const pid = String(id || getProjectId() || '').trim();
    const chosen = requestedFile || (pid === getProjectId() ? getSelectedFile() : '') || '';
    const key = `${pid}:${chosen}`;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      if (!pid) throw new Error('No project to share');
      const connected = await join();
      if (!connected?.ok) throw new Error(connected?.error || 'Join the public room first');
      let filename = chosen;
      if (!filename) {
        const project = await api(`/api/projects/${encodeURIComponent(pid)}`);
        filename = project?.latest_file || project?.generation?.filename || '';
      }
      if (!filename) throw new Error('This project has no 3D model to share yet');
      const shareUrl = await createShareUrl(pid,filename);
      const token = String(shareUrl).match(/\/share\/([^/?#]+)/i)?.[1];
      if (!token) throw new Error('Could not create a shared model link');
      const meta = await api(`/api/share/${encodeURIComponent(token)}`);
      const glbUrl = meta?.viewer_url;
      if (!glbUrl) throw new Error('The shared model has no viewable 3D asset');
      const project = getProjects().find(p=>p.id===pid);
      const name = project?.name || project?.label || meta.project_name || 'project';
      await spawn({project_id:pid,project_name:name,share_url:shareUrl,glb_url:glbUrl,
        filename:meta.viewer_filename || filename,kind:'import'});
      return {ok:true,message:`Shared ${name} — everyone can see and grab it`};
    })().finally(()=>pending.delete(key));
    pending.set(key,task);
    return task;
  };
}
