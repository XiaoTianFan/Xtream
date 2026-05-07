/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { createDraggableNumberField } from './draggableNumberField';

describe('createDraggableNumberField', () => {
  it('commits typed numeric values through the shared field path', () => {
    const commits: Array<number | undefined> = [];
    const field = createDraggableNumberField('Start', 10, (value) => commits.push(value), { min: 0, integer: true });
    document.body.append(field);

    const input = field.querySelector('input') as HTMLInputElement;
    input.value = '42.7';
    input.dispatchEvent(new Event('change'));

    expect(commits).toEqual([43]);
  });

  it('clears optional values when the input is blank', () => {
    const commits: Array<number | undefined> = [];
    const field = createDraggableNumberField('Play', 10, (value) => commits.push(value));
    document.body.append(field);

    const input = field.querySelector('input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change'));

    expect(commits).toEqual([undefined]);
  });
});
