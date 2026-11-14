import type {DesktopAPI} from '@firecnc/contracts';
declare global {interface Window {academy:DesktopAPI;MonacoEnvironment?:{getWorker:()=>Worker}}}
export {};
