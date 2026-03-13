# Skyward Backend Project Summary

This document provides a comprehensive overview of the Skyward Backend project, intended for context-setting for an LLM.

## Project Overview

The Skyward Backend is a Node.js application built with Express and TypeScript. It serves as the backend for the Skyward platform, which appears to be a system for managing sales and commissions related to entities called "SMDs". The platform supports various user roles, including administrators, marketers, and customers.

The application handles user authentication, data management for customers, marketers, and SMDs, and business logic for calculating commissions and managing payouts. It also includes features for generating PDF contracts and real-time communication.

## Technologies Used

-   **Backend Framework**: Express.js
-   **Language**: TypeScript
-   **Database**: PostgreSQL
-   **Authentication**: JSON Web Tokens (JWT)
-   **File Storage**: AWS S3 (for file uploads)
-   **Real-time Communication**: Socket.io
-   **Email**: Nodemailer
-   **PDF Generation**: Puppeteer
-   **Testing**: Jest
-   **Deployment**: The project includes a GitHub Actions workflow for deployment.


## Project Structure

The project follows a standard structure for a Node.js/Express application:

-   `src/`: The main source code directory.
-   `src/config/`: Configuration files for the database, CORS, etc.
-   `src/controllers/`: Contains the business logic for handling API requests for each model.
-   `src/routes/`: Defines the API endpoints and maps them to controller functions.
-   `src/middlewares/`: Includes authentication and authorization middleware.
-   `src/queries/`: Contains more complex database queries.
-   `src/utils/`: Utility functions for JWT, PDF generation, etc.
-   `src/views/`: EJS templates, likely for generating PDFs.
-   `prisma/`: Contains the Prisma schema and migration files.

## Key Functionality

-   **User Management**: Registration, login, and role-based access control.
-   **Customer Management**: CRUD operations for customers.
-   **Marketer Management**: Onboarding marketers and tracking their commissions.
-   **SMD Management**: Managing the lifecycle of SMDs, from creation to closing.
-   **Sales and Commissions**: Handling the sale of SMDs to customers, tracking payments, and calculating commissions for marketers.
-   **PDF Generation**: Generating PDF contracts for sales.
-   **Real-time Updates**: Using Socket.io for real-time notifications or updates.

## Authentication System

The application uses a JSON Web Token (JWT) based system for authentication.

-   **Token Generation**: Upon successful login, the `auth.controller.ts` generates two tokens:
    1.  An `accessToken` containing the user's payload.
    2.  A `refreshToken` stored in an HTTP-only cookie for persistent sessions.

-   **Middleware**: Secure routes are protected by the `authenticate` middleware (`src/middlewares/authenticate.ts`). This middleware:
    1.  Extracts the JWT from the `Authorization: Bearer <token>` header.
    2.  Verifies the token's validity.
    3.  Performs a crucial security check by querying the database to ensure the user's `status` is still `active`.
    4.  If the token is valid and the user is active, it attaches the decoded user payload to the Express `Request` object.

-   **Accessing User Data**: After the `authenticate` middleware runs, the user's information is available on the request object as `req.user`. The type is defined in `src/types/types.ts` as:
    ```typescript
    export interface JwtUser {
      user_id: string;
      email: string;
      role: "admin" | "staff"| "marketer" | "customer" | "user";
    }
    ```
    This `req.user` object can be accessed in any subsequent controller or middleware for authorization and business logic.

This summary should provide a good starting point for an LLM to understand the context of the Skyward Backend project.
