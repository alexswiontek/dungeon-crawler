import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    try {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    } catch {
      // Never crash error handler - silently ignore console failures
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
          <div className="max-w-md text-center">
            <h1 className="text-4xl font-bold mb-4">Oops!</h1>
            <p className="text-lg mb-6">
              Something went wrong. Please reload the page to continue playing.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Reload Page
            </button>
            {this.state.error && (
              <details className="mt-6 text-left text-sm">
                <summary className="cursor-pointer text-gray-400 hover:text-gray-300">
                  Error Details
                </summary>
                <pre className="mt-2 p-4 bg-gray-800 rounded overflow-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
