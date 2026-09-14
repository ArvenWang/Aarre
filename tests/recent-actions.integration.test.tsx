// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SettingsMoreContent } from '../src/ui/sidepanel/components/settings/SettingsMoreContent';
import type { UndoSnapshotBatch } from '../src/lib/types';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('loads the thirteenth action and sends its actual batch id to undo',async()=>{
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container),undo=vi.fn();
 const batches=Array.from({length:13},(_,i)=>({batchId:`batch-${i+1}`,label:`Change ${i+1}`,source:'manual',destructive:false,createdAt:'2026-09-09T00:00:00.000Z',expiresAt:'2026-10-09T00:00:00.000Z',status:'ready',mutations:[]} as UndoSnapshotBatch));
 try{await act(async()=>root.render(<SettingsMoreContent action="" undoBatches={batches} onUndo={undo}/>));expect(container.textContent).not.toContain('Change 13');const more=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('12/13'))!;await act(async()=>more.click());expect(container.textContent).toContain('Change 13');const last=[...container.querySelectorAll('article')].at(-1)!;await act(async()=>last.querySelector('button')!.click());expect(undo).toHaveBeenCalledWith('batch-13');}finally{await act(async()=>root.unmount());container.remove();}
});
