/**
 * Login.test.tsx — Smoke tests for the Login page.
 *
 * react-router-dom hooks (useNavigate, useLocation) are mocked inline so no
 * Router wrapper is required. MSW handles /api/auth/* requests.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import Login from '../pages/Login';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/login', search: '', hash: '' }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderLogin() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Login />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

describe('Login page', () => {
  it('renders username and password fields', () => {
    renderLogin();
    expect(
      screen.getByLabelText(/username/i) || screen.getByPlaceholderText(/username/i)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/password/i) || screen.getByPlaceholderText(/password/i)
    ).toBeInTheDocument();
  });

  it('shows a sign-in button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows an error for invalid credentials', async () => {
    renderLogin();
    const usernameEl =
      screen.getByLabelText(/username/i) || screen.getByPlaceholderText(/username/i);
    const passwordEl =
      screen.getByLabelText(/password/i) || screen.getByPlaceholderText(/password/i);
    const btn = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(usernameEl, { target: { value: 'bad' } });
    fireEvent.change(passwordEl, { target: { value: 'wrong' } });
    fireEvent.click(btn);

    await waitFor(
      () => {
        expect(
          screen.getByText(/invalid/i) || screen.getByRole('alert')
        ).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
