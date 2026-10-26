import React from 'react';import {createRoot} from 'react-dom/client';import {ModelsConfig} from '../components/ModelsConfig';import {I18nProvider} from '../hooks/useI18n';
createRoot(document.getElementById('root')).render(<I18nProvider><ModelsConfig embedded onClose={()=>{}}/></I18nProvider>);
