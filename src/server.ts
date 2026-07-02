import express from 'express';
import path from 'path';
import routes from './routes';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', routes);

app.listen(PORT, () => {
  console.log(`Link Reader API corriendo en http://localhost:${PORT}`);
});
