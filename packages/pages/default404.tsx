import { Button } from "components/button";
import { DocumentTitle } from "std/ui";

/**
  A customizable 404 page that displays a "page not found" message with an optional home button.

  @category Page Component
  @param props.redirectTo Optional destination URL when clicking the home button. If not provided, the home button will redirect to "/".
  @param props.showHomeButton Shows a redirect button that by default redirects to "/" .

 */
export function DefaultNotFoundPage({
  redirectTo,
  showHomeButton,
}: {
  redirectTo?: string;
  showHomeButton?: boolean;
}) {
  if (!!redirectTo && !showHomeButton) {
    throw new Error("showHomeButton is required when redirectTo is provided");
  }
  return (
    <>
      <DocumentTitle>Not Found</DocumentTitle>
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "primary-200",
          color: "primary-700",
          textAlign: "center",
          padding: "20px",
          width: "100%",
        }}
      >
        <h1 sx={{ fontSize: "6rem", marginBottom: "20px" }}>404</h1>
        <p sx={{ fontSize: "1.5rem", marginBottom: "20px" }}>
          Oops! The page you're looking for doesn't exist.
        </p>
        {showHomeButton && (
          <Button startIcon="Home" variant="outlined" href={redirectTo || "/"}>
            Go home
          </Button>
        )}
      </div>
    </>
  );
}
