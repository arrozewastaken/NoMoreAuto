import eel

eel.init('web')

@eel.expose
def hello():
    return "Hello from Python!"

eel.start('index.html', size=(600, 400))



#-----------------------------


from dotenv import load_dotenv
import os

load_dotenv()

key = os.getenv("FIREBASE_KEY")