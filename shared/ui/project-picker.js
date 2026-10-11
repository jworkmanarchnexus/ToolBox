/* Shared project picker: a labelled <select> of the projects the signed-in person can see (from Directory).
   The last choice is remembered per device through pref(). Any module can use it:
     const picker = await projectPicker({ onChange: (project) => ... });  parent.append(picker.el);  */
import { Directory, pref } from '../platform/index.js';

const h = (...a) => window.Toolbox.h(...a);

export async function projectPicker({ onChange, scope = 'all', label = 'Project' } = {}) {
  const projects = await Directory.projects({ scope });
  const select = h('select', { class: 'txt', id: 'project-picker' });
  const remembered = pref('project');
  select.append(h('option', { value: '', text: projects.length ? 'Choose a project' : 'No projects available' }));
  for (const p of projects) select.append(h('option', { value: p.id, text: `${p.number}  ${p.name}` }));
  if (projects.some(p => p.id === remembered)) select.value = remembered;
  const current = () => projects.find(p => p.id === select.value) || null;
  select.addEventListener('change', () => { pref('project', select.value); if (onChange) onChange(current()); });
  const el = h('div', { class: 'field' }, h('label', { for: 'project-picker', text: label }), select);
  return { el, projects, current };
}
