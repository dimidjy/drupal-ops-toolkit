import { describe, expect, it } from 'vitest';
import { escapeHtml, renderReport } from '../src/report.js';

describe('renderReport', () => {
  const html = renderReport(
    {
      title: 'shop <staging>',
      beforeDir: '/out/shop/before',
      afterDir: '/out/shop/after',
      beforeLabel: 'before',
      afterLabel: 'after',
      results: [
        {
          name: 'home.png',
          status: 'same',
          diffPixels: 0,
          ratio: 0,
          diffFile: '/out/shop/diff/home.png',
        },
        {
          name: 'cart.png',
          status: 'changed',
          diffPixels: 50,
          ratio: 0.05,
          diffFile: '/out/shop/diff/cart.png',
        },
        { name: 'new.png', status: 'added', diffPixels: 0, ratio: 1 },
      ],
    },
    '/out/shop/report.html',
  );

  it('escapes the title', () => {
    expect(html).toContain('<title>shop &lt;staging&gt;</title>');
  });

  it('uses image paths relative to the report', () => {
    expect(html).toContain('src="before/cart.png"');
    expect(html).toContain('src="diff/cart.png"');
  });

  it('lists changed pages first and summarises the count', () => {
    expect(html.indexOf('cart.png')).toBeLessThan(html.indexOf('home.png'));
    expect(html).toContain('2 of 3 pages differ');
  });

  it('shows no before image for added pages', () => {
    expect(html).not.toContain('before/new.png');
    expect(html).toContain('after/new.png');
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
