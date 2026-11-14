import {useEffect,useRef} from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import type {Diagnostic} from '@firecnc/core';
window.MonacoEnvironment={getWorker:()=>new EditorWorker()};
monaco.languages.register({id:'firecnc'});
monaco.languages.setMonarchTokensProvider('firecnc',{tokenizer:{root:[[/\([^)]*\)|;.*/,'comment'],[/\bG\s*\d+/i,'keyword'],[/\bM\s*\d+/i,'type'],[/\b[XYZIJKR]\s*[+-]?[\d.]+/i,'number'],[/\b[FTSN]\s*[\d.]+/i,'identifier']]}});
monaco.languages.registerCompletionItemProvider('firecnc',{provideCompletionItems:()=>({suggestions:['G0','G1','G2','G3','G17','G18','G21','G54','G90','G91','M0','M3','M4','M5','M6','M8','M9','M30'].map(label=>({label,kind:monaco.languages.CompletionItemKind.Keyword,insertText:label,range:undefined as never}))})});
export function CodeEditor({value,onChange,line,error,theme,onSave}:{value:string;onChange:(s:string)=>void;line:number;error:Diagnostic|null;theme:'dark'|'light';onSave:()=>void}) {
  const programmatic=useRef(false),host=useRef<HTMLDivElement>(null),editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null),change=useRef(onChange),save=useRef(onSave),decorations=useRef<monaco.editor.IEditorDecorationsCollection|null>(null);
  change.current=onChange;save.current=onSave;
  useEffect(()=>{
    const instance=monaco.editor.create(host.current!,{value,language:'firecnc',theme:theme==='dark'?'vs-dark':'vs',automaticLayout:true,editContext:false,minimap:{enabled:false},fontSize:14,lineHeight:24,scrollBeyondLastLine:false,tabSize:2,wordWrap:'off',padding:{top:16},accessibilitySupport:'on',ariaLabel:'Редактор программы ЧПУ',renderLineHighlight:'all'});
    editor.current=instance;decorations.current=instance.createDecorationsCollection();
    const listener=instance.onDidChangeModelContent(()=>{if(!programmatic.current)change.current(instance.getValue());});
    instance.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,()=>save.current());
    return ()=>{listener.dispose();const model=instance.getModel();instance.dispose();model?.dispose();};
  },[]);
  useEffect(()=>{if(editor.current&&editor.current.getValue()!==value){programmatic.current=true;editor.current.setValue(value);programmatic.current=false;}},[value]);
  useEffect(()=>{monaco.editor.setTheme(theme==='dark'?'vs-dark':'vs');},[theme]);
  useEffect(()=>{
    decorations.current?.set(line>0?[{range:new monaco.Range(line,1,line,1),options:{isWholeLine:true,className:'executed-line',linesDecorationsClassName:'executed-gutter'}}]:[]);
    if(line>0)editor.current?.revealLineInCenterIfOutsideViewport(line);
  },[line]);
  useEffect(()=>{
    const model=editor.current?.getModel();if(!model)return;
    monaco.editor.setModelMarkers(model,'cnc',error?[{startLineNumber:error.line,endLineNumber:error.line,startColumn:error.column,endColumn:model.getLineMaxColumn(error.line),severity:monaco.MarkerSeverity.Error,message:error.message+' '+error.fix}]:[]);
    if(error)editor.current?.revealLineInCenter(error.line);
  },[error]);
  return <div className="code-editor" ref={host}/>;
}
