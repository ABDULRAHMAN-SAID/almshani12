import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/** جذر HTML للويب فقط — العربية وRTL أصلاً، لا كترجمة لاحقة */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content="#FBF7F0" />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `html,body{background:#FBF7F0;height:100%}html[data-theme=dark],html[data-theme=dark] body{background:#0E0F12}body{margin:0;overflow-x:hidden}#root{display:flex;flex:1;min-height:100%}`,
          }}
        />
        {/* يُطبَّق تفضيل الوضع الليلي المحفوظ قبل رسم أي شيء */}
        <script dangerouslySetInnerHTML={{ __html: `try{var p=JSON.parse(localStorage.getItem('mn_prefs')||'{}');var d=p.themePref==='dark'||(p.themePref!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.setAttribute('data-theme','dark')}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
