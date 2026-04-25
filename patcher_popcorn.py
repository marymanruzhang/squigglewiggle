with open('animation_engine/category_map.py', 'r') as f:
    content = f.read()
import re
content = re.sub(r'\}', '    "popcorn": AnimationType.BOUNCE,\n}', content, count=1)
with open('animation_engine/category_map.py', 'w') as f:
    f.write(content)
