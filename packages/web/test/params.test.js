import { describe, expect, it } from 'vitest';
import { placeholdersIn, splitParams } from '../src/components/ParamFields.jsx';

const context = {
  definitions: [{ name: 'branch', description: 'Branch', default: 'main' }],
  siteParams: { fr: ['alias', 'uri'], de: ['alias'] },
};

describe('parameter fields', () => {
  it('ignores built-in placeholders and shell variables', () => {
    expect(placeholdersIn('cd {path} && echo ${HOME} {branch} {target}')).toEqual(['branch']);
  });

  it('asks for a site for site-only values and a field for the rest', () => {
    expect(splitParams(['alias', 'branch', 'ticket'], '', context)).toEqual({
      needsSite: true,
      fields: ['branch', 'ticket'],
    });
  });

  it('drops fields the chosen site fills in', () => {
    expect(splitParams(['uri', 'branch'], 'fr', context).fields).toEqual(['branch']);
  });
});
