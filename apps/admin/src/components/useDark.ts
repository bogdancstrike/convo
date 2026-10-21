import { createContext, useContext } from 'react';

/** Whether the console is in dark mode (set by the shell). */
export const DarkContext = createContext(false);
export const useDark = () => useContext(DarkContext);
