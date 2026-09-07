// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {WorkProgramElementEditor} from '@/components/programs/work-program/element-editor';
import type {WorkProgramElement} from '@/lib/programs/work-program/schema';
const initial:WorkProgramElement={id:'work',source:null,code:'',title:'',disposition:'unresolved',decisionNote:'',objective:'',discussion:'',responsible:'',schedule:'',personMonths:null,budgetTreatment:'unresolved',budgetTreatmentNote:'',tasks:[],products:[],budget:[],projectId:null};
afterEach(cleanup);
it('keeps new work open while typing its title and gives selects a stable accessible name',()=>{
 function Editor(){const [element,setElement]=useState(initial);return <WorkProgramElementEditor element={element} onChange={setElement} projects={[]} sources={[]}/>;}
 const view=render(<Editor/>);
 fireEvent.change(screen.getByRole('textbox',{name:'Work element title'}),{target:{value:'Administration'}});
 expect(view.container.querySelector('details')).toHaveAttribute('open');
 expect(screen.getByRole('textbox',{name:'Proposed objective'})).toBeVisible();
 expect(screen.getByRole('combobox',{name:'Carry-forward decision'})).toHaveValue('unresolved');
});
