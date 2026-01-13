# Skyward Backend

This is the backend for the Skyward application, a platform for managing users with different roles like marketers and SMDs. It is built with Node.js, Express, and TypeScript.

## Features

*   **Authentication**: User registration and login with JWT-based authentication.
*   **User Roles**: Support for different user roles like Marketer and SMD.
*   **Secure Password Storage**: Passwords are encrypted using bcrypt.
*   **File Uploads**: Supports file uploads to AWS S3.
*   **Real-time Communication**: Uses Socket.io for real-time features.
*   **Emailing**: Sends emails using Nodemailer.
*   **Scalable Architecture**: Follows a modular and scalable project structure.

## Technologies Used

*   **Node.js**: JavaScript runtime environment.
*   **Express**: Web framework for Node.js.
*   **TypeScript**: Typed superset of JavaScript.
*   **PostgreSQL**: Relational database.
*   **JWT**: For secure authentication.
*   **Socket.io**: For real-time communication.
*   **AWS S3**: For file storage.
*   **Nodemailer**: For sending emails.
*   **Jest**: For testing.

---

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   [Node.js](https://nodejs.org/)
*   [PostgreSQL](https://www.postgresql.org/)
*   [AWS S3 Bucket](https://aws.amazon.com/s3/)

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/your-username/skyward-backend.git
    cd skyward-backend
    ```

2.  Install the dependencies:
    ```sh
    npm install
    ```

3.  Create a `.env` file in the root of the project and add the following environment variables:
    ```
    PORT=3000
    DB_HOST=localhost
    DB_USER=your_db_user
    DB_PASSWORD=your_db_password
    DB_NAME=your_db_name
    DB_PORT=5432
    JWT_SECRET=your_jwt_secret
    AWS_ACCESS_KEY_ID=your_aws_access_key
    AWS_SECRET_ACCESS_KEY=your_aws_secret_key
    AWS_REGION=your_aws_region
    S3_BUCKET_NAME=your_s3_bucket_name
    EMAIL_HOST=your_email_host
    EMAIL_PORT=your_email_port
    EMAIL_USER=your_email_user
    EMAIL_PASS=your_email_password
    ```

### Running the Application

*   **Development Mode**:
    ```sh
    npm run dev
    ```
    This will start the server with `ts-node-dev`, which will automatically restart the server on file changes.

*   **Production Mode**:
    First, build the TypeScript code:
    ```sh
    npm run build
    ```
    Then, start the server:
    ```sh
    npm start
    ```

### API Endpoints

The API routes are defined in the `src/routes` directory.

*   **Auth Routes**: `/api/auth`
    *   `POST /register` - Register a new user
    *   `POST /login` - Login a user
*   **SMD Routes**: `/api`
*   **Marketer Routes**: `/api`

### Project Structure

```
.
├── src
│   ├── app.ts
│   ├── index.ts
│   ├── config
│   ├── controllers
│   ├── middlewares
│   ├── routes
│   ├── types
│   └── utils
├── package.json
├── tsconfig.json
└── ...
```

### Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

### License

This project is licensed under the ISC License.
