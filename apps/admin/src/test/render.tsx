import { render } from '@testing-library/react';
import { App } from 'antd';
import type { ReactElement } from 'react';

/** Renders inside antd's App, which provides the message and modal APIs the console uses. */
export function renderWithApp(ui: ReactElement) {
  return render(<App>{ui}</App>);
}
