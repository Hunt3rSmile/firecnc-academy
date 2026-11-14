import {contextBridge,ipcRenderer} from 'electron';
import type {DesktopAPI,UpdateView} from '@firecnc/contracts';
const api:DesktopAPI={
  security:Object.freeze({sandbox:process.sandboxed===true,contextIsolation:process.contextIsolated===true}),
  state:()=>ipcRenderer.invoke('state'),profile:v=>ipcRenderer.invoke('profile',v),lessonComplete:v=>ipcRenderer.invoke('lessonComplete',v),quizSubmit:v=>ipcRenderer.invoke('quizSubmit',v),settings:v=>ipcRenderer.invoke('settings',v),
  projectSave:v=>ipcRenderer.invoke('projectSave',v),projectImport:()=>ipcRenderer.invoke('projectImport'),projectExport:v=>ipcRenderer.invoke('projectExport',v),programOpen:()=>ipcRenderer.invoke('programOpen'),programSave:v=>ipcRenderer.invoke('programSave',v),
  authorizeSimulation:v=>ipcRenderer.invoke('authorizeSimulation',v),licenseImport:v=>ipcRenderer.invoke('licenseImport',v),licenseOpen:()=>ipcRenderer.invoke('licenseOpen'),licenseExport:()=>ipcRenderer.invoke('licenseExport'),activationRequest:()=>ipcRenderer.invoke('activationRequest'),exportResults:()=>ipcRenderer.invoke('exportResults'),backup:()=>ipcRenderer.invoke('backup'),
  updateCheck:()=>ipcRenderer.invoke('updateCheck'),updateAutomatic:v=>ipcRenderer.invoke('updateAutomatic',v),updateOpen:()=>ipcRenderer.invoke('updateOpen'),
  onUpdates:callback=>{const listener=(_event:unknown,value:UpdateView)=>callback(value);ipcRenderer.on('updates:changed',listener);return ()=>ipcRenderer.removeListener('updates:changed',listener);}
};
contextBridge.exposeInMainWorld('academy',Object.freeze(api));
